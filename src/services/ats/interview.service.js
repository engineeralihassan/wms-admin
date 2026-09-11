const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  Job,
  JobApplication,
  ApplicationEvent,
  Interview,
  InterviewParticipant,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { paginate } = require('../../utils/query/paginate');
const { INTERVIEW_QUERY_CONFIG, USER_QUERY_CONFIG } = require('../../config/query-configs');
const emailService = require('../email/email.service');
const { buildJobScope, nextSequenceCode } = require('./ats.shared');
const providerRegistry = require('./calendar/provider.registry');
const availability = require('./scheduling/availability');
const { config: calendarConfig } = require('../../config/calendar');
const {
  APPLICATION_STATUSES,
  APPLICATION_EVENT_TYPES,
  INTERVIEW_STATUSES,
  INTERVIEW_ACTIVE_STATUSES,
  INTERVIEW_TERMINAL_STATUSES,
  INTERVIEW_MODES,
  INTERVIEW_PARTICIPANT_ROLES,
  INTERVIEW_RESPONSE_STATUSES,
  INTERVIEW_SCHEDULABLE_APPLICATION_STATUSES,
  INTERVIEW_LIMITS,
  INTERVIEW_DEFAULT_WORKING_HOURS,
  INTERVIEW_CODE_PREFIX,
} = require('../../utils/ats.constants');

/**
 * interview.service — scheduling interviews for a shortlisted candidate.
 *
 * Visibility mirrors applications exactly: a recruiter can only schedule on candidates
 * whose parent job they own (buildJobScope); an org admin sees all. Every booking,
 * reschedule, cancellation and completion:
 *   - runs inside a transaction with a row lock on the parent application (so two
 *     recruiters can't race the workflow transition);
 *   - re-checks interviewer conflicts at commit time (no double-booking);
 *   - creates/updates/cancels the external calendar event via the pluggable provider;
 *   - advances the application (SHORTLISTED -> INTERVIEWING) on the first interview;
 *   - appends an immutable ApplicationEvent to the audit trail;
 *   - fires (fire-and-forget) invite/update/cancel emails to the panel + candidate.
 */

const PARTICIPANT_INCLUDE = {
  model: InterviewParticipant,
  as: 'participants',
  include: [{ model: User, as: 'user', attributes: ['uuid', 'first_name', 'last_name', 'email'] }],
};

const INTERVIEW_INCLUDE = [
  { model: Job, as: 'job', attributes: ['uuid', 'job_code', 'title', 'interview_rounds', 'created_by_id'] },
  {
    model: JobApplication,
    as: 'application',
    attributes: ['uuid', 'application_number', 'candidate_name', 'candidate_email', 'status', 'stage_key'],
  },
  { model: User, as: 'organizer', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  PARTICIPANT_INCLUDE,
];

// ── Internal helpers ────────────────────────────────────────────────────────────

/**
 * Resolve the application by uuid, enforcing tenant + recruiter-ownership visibility.
 * Optionally locks the row (for write paths). Returns the application with its job.
 */
const findVisibleApplication = async (uuid, req, res, { transaction, lock } = {}) => {
  const application = await JobApplication.findOne({
    where: { uuid, ...req.tenantWhere },
    include: [
      {
        model: Job,
        as: 'job',
        attributes: ['id', 'uuid', 'job_code', 'title', 'interview_rounds', 'created_by_id'],
        required: true,
      },
    ],
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
  }
  const jobScope = buildJobScope(req);
  if (jobScope.created_by_id !== undefined && application.job.created_by_id !== jobScope.created_by_id) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
  }
  return application;
};

/** Validate a stage_key against the job's interview_rounds; return the round. */
const resolveRound = (job, stageKey, res) => {
  const rounds = Array.isArray(job.interview_rounds) ? job.interview_rounds : [];
  const round = rounds.find((r) => r.key === stageKey);
  if (!round) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('application_invalid_stage'));
  }
  return round;
};

/**
 * Resolve requested interviewer users (by uuid) within a specific organization. The org
 * is derived from the parent application (the resource), NOT the caller's token — so a
 * super-admin acting on an application in org A can't attach a panelist from org B, and
 * the panel always belongs to the same tenant as the interview. Throws if any uuid is
 * unknown or outside that org. Returns [{ id, uuid, name, email }].
 */
const resolveInterviewers = async (interviewerUuids, organizationId, res, transaction) => {
  const uuids = [...new Set(interviewerUuids || [])];
  if (!uuids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_interviewers_required'));
  }
  const users = await User.findAll({
    where: { uuid: { [Op.in]: uuids }, organization_id: organizationId },
    attributes: ['id', 'uuid', 'first_name', 'last_name', 'email'],
    transaction,
  });
  if (users.length !== uuids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_interviewer_not_found'));
  }
  return users.map((u) => ({
    id: u.id,
    uuid: u.uuid,
    name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
    email: u.email,
  }));
};

/**
 * Load the acting user's identity (email + name) for the organizer participant row.
 * The auth token only carries id/uuid, so we must read the real record — otherwise the
 * organizer email is invalid and the participant insert fails.
 */
const loadOrganizer = async (userId, transaction) => {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'first_name', 'last_name', 'email'],
    transaction,
  });
  return {
    id: userId,
    email: user?.email || null,
    name: user ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null : null,
  };
};

/**
 * Existing active-interview windows for a set of interviewer user ids in a tenant,
 * optionally excluding one interview (for reschedule). Powers conflict detection and
 * the availability endpoint's busy list.
 *
 * ALWAYS bounded by [rangeStart, rangeEnd] so the scan is proportional to the queried
 * window, not the interviewer's lifetime history. Overlap is `start <= rangeEnd AND
 * end >= rangeStart`. Callers pass the availability window, or the single-slot window
 * (widened by the buffer) for the commit-time conflict check.
 */
const busyWindowsForUsers = async (
  organizationId,
  userIds,
  rangeStart,
  rangeEnd,
  { excludeInterviewId, transaction } = {}
) => {
  if (!userIds.length) return [];
  const interviewWhere = {
    organization_id: organizationId,
    status: { [Op.in]: INTERVIEW_ACTIVE_STATUSES },
    scheduled_start: { [Op.lte]: rangeEnd },
    scheduled_end: { [Op.gte]: rangeStart },
  };
  if (excludeInterviewId) interviewWhere.id = { [Op.ne]: excludeInterviewId };

  const rows = await Interview.findAll({
    where: interviewWhere,
    attributes: ['id', 'scheduled_start', 'scheduled_end'],
    include: [
      {
        model: InterviewParticipant,
        as: 'participants',
        attributes: [],
        required: true,
        where: { user_id: { [Op.in]: userIds } },
      },
    ],
    transaction,
  });
  return rows.map((r) => ({ start: r.scheduled_start, end: r.scheduled_end }));
};

/** Build the provider call context from an interview + its participants. */
const buildProviderContext = (interview, round, application, interviewers, candidate, extra = {}) => ({
  idempotencyKey: interview.uuid,
  title: interview.title || `${round.name} — ${application.candidate_name}`,
  description: interview.notes || undefined,
  start: interview.scheduled_start,
  end: interview.scheduled_end,
  timezone: interview.timezone,
  mode: interview.mode,
  location: interview.location,
  meetingUrl: interview.meeting_url,
  externalEventId: interview.external_event_id,
  attendees: [candidate, ...interviewers].filter(Boolean).map((a) => ({ email: a.email, name: a.name })),
  ...extra,
});

/** Fire invite/update/cancel emails to the candidate + panel (never throws). */
const notifyParticipants = (templateKey, interview, round, application, interviewers, candidate, extra = {}) => {
  const base = {
    interviewNumber: interview.interview_number,
    roundName: round?.name || interview.stage_key,
    jobTitle: application.job?.title || '',
    candidateName: application.candidate_name,
    start: interview.scheduled_start,
    timezone: interview.timezone,
    mode: interview.mode,
    meetingUrl: interview.meeting_url || '',
    location: interview.location || '',
    ...extra,
  };
  const recipients = [candidate, ...interviewers].filter((r) => r && r.email);
  recipients.forEach((r) => {
    emailService.enqueueSafe(templateKey, r.email, { ...base, recipientName: r.name });
  });
};

const workingHoursForOrg = () => INTERVIEW_DEFAULT_WORKING_HOURS;

// ── Public: interviewer directory ─────────────────────────────────────────────

/**
 * List the org's active users as interviewer options for scheduling.
 *
 * Guarded by interview.create at the route, so a recruiter who can schedule can fetch
 * the panel candidates WITHOUT needing user.read (they must never see the Users module).
 * Scoped to the parent application's organization (derived from the resource, never the
 * request body) — mirrors the tickets/projects "assignable-users" pattern. Paginated +
 * searchable server-side so we never ship the whole directory.
 */
const listInterviewers = async (uuid, req, res) => {
  const application = await findVisibleApplication(uuid, req, res);
  const scopeWhere = { organization_id: application.organization_id, status: 'active' };
  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere,
    attributes: ['id', 'uuid', 'first_name', 'last_name', 'email'],
  });
};

// ── Public: availability ──────────────────────────────────────────────────────

/**
 * Compute bookable slots for an application's next interview. Reads the requested
 * interviewers' existing bookings and subtracts them (plus a buffer) from the org's
 * working hours across the requested window.
 */
const getAvailability = async (uuid, query, req, res) => {
  const application = await findVisibleApplication(uuid, req, res);

  const timezone = query.timezone;
  if (!availability.isValidTimezone(timezone)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_invalid_timezone'));
  }

  const rangeStart = new Date(query.date_from);
  const rangeEnd = new Date(query.date_to);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd <= rangeStart) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_invalid_range'));
  }
  const spanDays = (rangeEnd - rangeStart) / (24 * 60 * 60000);
  if (spanDays > INTERVIEW_LIMITS.MAX_AVAILABILITY_WINDOW_DAYS) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_range_too_large'));
  }

  const duration = query.duration_minutes || calendarConfig.scheduling.defaultDurationMinutes;
  const interviewers = await resolveInterviewers(
    query.interviewer_uuids,
    application.organization_id,
    res
  );
  const busy = await busyWindowsForUsers(
    application.organization_id,
    interviewers.map((i) => i.id),
    rangeStart,
    rangeEnd
  );

  const slots = availability.generateSlots({
    rangeStart,
    rangeEnd,
    durationMinutes: duration,
    timezone,
    busy,
    workingHours: workingHoursForOrg(),
    granularityMinutes: calendarConfig.scheduling.slotGranularityMinutes,
    bufferMinutes: calendarConfig.scheduling.bufferMinutes,
  });

  return {
    timezone,
    duration_minutes: duration,
    slot_granularity_minutes: calendarConfig.scheduling.slotGranularityMinutes,
    buffer_minutes: calendarConfig.scheduling.bufferMinutes,
    interviewers: interviewers.map((i) => ({ uuid: i.uuid, name: i.name, email: i.email })),
    slots,
  };
};

// ── Public: list + read ─────────────────────────────────────────────────────────

/** Interviews for one application (paginated), scoped to what the caller can see. */
const listForApplication = async (uuid, req, res) => {
  const application = await findVisibleApplication(uuid, req, res);
  return paginate(Interview, req.query, INTERVIEW_QUERY_CONFIG, {
    scopeWhere: { organization_id: application.organization_id, application_id: application.id },
    include: INTERVIEW_INCLUDE,
  });
};

/**
 * Resolve one interview by uuid, enforcing visibility through its parent application,
 * and return it WITH its associations (job/application/organizer/participants).
 *
 * When `lock` is requested we must NOT combine `FOR UPDATE` with the participant join:
 * Postgres rejects a row lock on the nullable side of an outer join (the candidate
 * participant has a null user_id). So we take the row lock on the BASE interview row
 * only (no includes), then load the full graph in a second, unlocked read within the
 * same transaction. The lock still guarantees no concurrent lifecycle change.
 */
const findVisibleInterview = async (uuid, req, res, { transaction, lock } = {}) => {
  if (lock) {
    // 1) Lock the base row only (no joins) — safe for FOR UPDATE.
    const locked = await Interview.findOne({
      where: { uuid, ...req.tenantWhere },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('interview_not_found'));
    }
  }

  const interview = await Interview.findOne({
    where: { uuid, ...req.tenantWhere },
    include: INTERVIEW_INCLUDE,
    transaction,
  });
  if (!interview) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('interview_not_found'));
  }
  const jobScope = buildJobScope(req);
  if (jobScope.created_by_id !== undefined && interview.job?.created_by_id !== jobScope.created_by_id) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('interview_not_found'));
  }
  return interview;
};

const getInterviewByUuid = async (uuid, req, res) => findVisibleInterview(uuid, req, res);

// ── Public: schedule ──────────────────────────────────────────────────────────

/**
 * Book a new interview for a shortlisted/interviewing application.
 * Payload: { stage_key, start, duration_minutes, timezone, mode, provider,
 *            interviewer_uuids[], meeting_url?, location?, title?, notes? }
 */
const scheduleInterview = async (uuid, payload, req, res) => {
  const start = new Date(payload.start);
  if (Number.isNaN(start.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_invalid_range'));
  }
  if (start.getTime() < Date.now()) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_start_in_past'));
  }
  if (!availability.isValidTimezone(payload.timezone)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_invalid_timezone'));
  }
  const duration = payload.duration_minutes || calendarConfig.scheduling.defaultDurationMinutes;
  const end = new Date(start.getTime() + duration * 60000);
  const bufferMinutes = calendarConfig.scheduling.bufferMinutes;
  // The window the conflict check needs to look at: the slot widened by the buffer.
  const conflictRangeStart = new Date(start.getTime() - bufferMinutes * 60000);
  const conflictRangeEnd = new Date(end.getTime() + bufferMinutes * 60000);

  // Phase 1 — book atomically (row rows + status advance + audit). NO external HTTP here:
  // the calendar call is deferred to phase 2 so we never hold a row lock across a slow
  // third-party request (which would pin a DB connection under load).
  const result = await sequelize.transaction(async (transaction) => {
    const application = await findVisibleApplication(uuid, req, res, { transaction, lock: true });

    if (!INTERVIEW_SCHEDULABLE_APPLICATION_STATUSES.includes(application.status)) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_not_schedulable'));
    }
    const round = resolveRound(application.job, payload.stage_key, res);

    // Interviewers scoped to the application's org (not the caller's token).
    const interviewers = await resolveInterviewers(
      payload.interviewer_uuids,
      application.organization_id,
      res,
      transaction
    );
    const organizer = await loadOrganizer(req.auth.userId, transaction);

    // Conflict check inside the txn against a fresh, date-bounded busy list.
    const busy = await busyWindowsForUsers(
      application.organization_id,
      interviewers.map((i) => i.id),
      conflictRangeStart,
      conflictRangeEnd,
      { transaction }
    );
    if (availability.hasConflict({ start, end, busy, bufferMinutes })) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_slot_conflict'));
    }

    const interviewNumber = await nextSequenceCode(Interview, INTERVIEW_CODE_PREFIX, transaction);
    // Resolve the provider now (for the stored provider key) but call it AFTER commit.
    const { effectiveKey } = providerRegistry.resolve(payload.provider || calendarConfig.defaultProvider);

    const interview = await Interview.create(
      {
        interview_number: interviewNumber,
        organization_id: application.organization_id,
        job_id: application.job.id,
        application_id: application.id,
        stage_key: round.key,
        organizer_id: req.auth.userId,
        title: payload.title || `${round.name} — ${application.candidate_name}`,
        scheduled_start: start,
        scheduled_end: end,
        duration_minutes: duration,
        timezone: payload.timezone,
        mode: payload.mode || INTERVIEW_MODES.VIDEO,
        provider: effectiveKey,
        meeting_url: payload.meeting_url || null,
        location: payload.location || null,
        notes: payload.notes || null,
        status: INTERVIEW_STATUSES.SCHEDULED,
      },
      { transaction }
    );

    // Participant rows: organizer (real identity), interviewers, candidate.
    const participantRows = [
      {
        organization_id: application.organization_id,
        interview_id: interview.id,
        user_id: req.auth.userId,
        role: INTERVIEW_PARTICIPANT_ROLES.ORGANIZER,
        email: organizer.email,
        name: organizer.name,
        response_status: INTERVIEW_RESPONSE_STATUSES.ACCEPTED,
      },
      ...interviewers.map((i) => ({
        organization_id: application.organization_id,
        interview_id: interview.id,
        user_id: i.id,
        role: INTERVIEW_PARTICIPANT_ROLES.INTERVIEWER,
        email: i.email,
        name: i.name || null,
        response_status: INTERVIEW_RESPONSE_STATUSES.PENDING,
      })),
      {
        organization_id: application.organization_id,
        interview_id: interview.id,
        user_id: null,
        role: INTERVIEW_PARTICIPANT_ROLES.CANDIDATE,
        email: application.candidate_email,
        name: application.candidate_name,
        response_status: INTERVIEW_RESPONSE_STATUSES.PENDING,
      },
    ];
    await InterviewParticipant.bulkCreate(participantRows, { transaction });

    // Advance the application into INTERVIEWING at this round (if not already there).
    const fromStatus = application.status;
    const fromStage = application.stage_key;
    if (application.status !== APPLICATION_STATUSES.INTERVIEWING || application.stage_key !== round.key) {
      application.status = APPLICATION_STATUSES.INTERVIEWING;
      application.stage_key = round.key;
      application.reviewed_by_id = req.auth.userId;
      await application.save({ transaction });

      if (fromStatus !== APPLICATION_STATUSES.INTERVIEWING) {
        await ApplicationEvent.create(
          {
            organization_id: application.organization_id,
            application_id: application.id,
            created_by_id: req.auth.userId,
            entry_type: APPLICATION_EVENT_TYPES.STATUS_CHANGED,
            from_value: fromStatus,
            to_value: APPLICATION_STATUSES.INTERVIEWING,
          },
          { transaction }
        );
      }
      if (fromStage !== round.key) {
        await ApplicationEvent.create(
          {
            organization_id: application.organization_id,
            application_id: application.id,
            created_by_id: req.auth.userId,
            entry_type: APPLICATION_EVENT_TYPES.STAGE_CHANGED,
            from_value: fromStage,
            to_value: round.key,
          },
          { transaction }
        );
      }
    }

    // Audit: the scheduling itself.
    await ApplicationEvent.create(
      {
        organization_id: application.organization_id,
        application_id: application.id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.INTERVIEW_SCHEDULED,
        from_value: null,
        to_value: interview.interview_number,
        note: `${round.name} @ ${start.toISOString()}`,
      },
      { transaction }
    );

    return { interview, round, application, interviewers, candidate: { email: application.candidate_email, name: application.candidate_name } };
  });

  // Phase 2 — create the external calendar event OUTSIDE the transaction, then patch the
  // interview with the event id / meeting link. A slow or failing provider no longer
  // holds any DB lock; on failure the booking simply stays "manual-style".
  const { interview, round, application, interviewers, candidate } = result;
  const { provider, effectiveKey } = providerRegistry.resolve(interview.provider);
  try {
    const providerOut = await provider.createEvent(
      buildProviderContext(interview, round, application, interviewers, candidate)
    );
    interview.external_event_id = providerOut.external_event_id || null;
    interview.meeting_url = providerOut.meeting_url || interview.meeting_url || null;
    if (providerOut.location) interview.location = providerOut.location;
    interview.provider_meta = providerOut.provider_meta || null;
    await interview.save();
  } catch (err) {
    logger.error(`[interview] provider "${effectiveKey}" createEvent failed: ${err.message}`);
  }

  // Notify the panel + candidate (fire-and-forget).
  notifyParticipants('interview_scheduled', interview, round, application, interviewers, candidate);

  // Return the full graph for the response.
  return Interview.findOne({ where: { id: interview.id }, include: INTERVIEW_INCLUDE });
};

// ── Public: reschedule ────────────────────────────────────────────────────────

const rescheduleInterview = async (uuid, payload, req, res) => {
  const start = new Date(payload.start);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_start_in_past'));
  }
  if (payload.timezone && !availability.isValidTimezone(payload.timezone)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('interview_invalid_timezone'));
  }

  const bufferMinutes = calendarConfig.scheduling.bufferMinutes;

  // Phase 1 — validate + move the booking atomically (no external HTTP under the lock).
  const result = await sequelize.transaction(async (transaction) => {
    const interview = await findVisibleInterview(uuid, req, res, { transaction, lock: true });
    if (INTERVIEW_TERMINAL_STATUSES.includes(interview.status)) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_not_active'));
    }
    const duration = payload.duration_minutes || interview.duration_minutes;
    const end = new Date(start.getTime() + duration * 60000);

    const interviewerIds = (interview.participants || [])
      .filter((p) => p.role === INTERVIEW_PARTICIPANT_ROLES.INTERVIEWER && p.user_id)
      .map((p) => p.user_id);

    const busy = await busyWindowsForUsers(
      interview.organization_id,
      interviewerIds,
      new Date(start.getTime() - bufferMinutes * 60000),
      new Date(end.getTime() + bufferMinutes * 60000),
      { excludeInterviewId: interview.id, transaction }
    );
    if (availability.hasConflict({ start, end, busy, bufferMinutes })) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_slot_conflict'));
    }

    const fromStart = interview.scheduled_start;
    interview.scheduled_start = start;
    interview.scheduled_end = end;
    interview.duration_minutes = duration;
    if (payload.timezone) interview.timezone = payload.timezone;
    if (payload.meeting_url !== undefined) interview.meeting_url = payload.meeting_url;
    if (payload.location !== undefined) interview.location = payload.location;
    interview.status = INTERVIEW_STATUSES.RESCHEDULED;
    await interview.save({ transaction });

    await ApplicationEvent.create(
      {
        organization_id: interview.organization_id,
        application_id: interview.application_id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.INTERVIEW_RESCHEDULED,
        from_value: fromStart ? new Date(fromStart).toISOString() : null,
        to_value: start.toISOString(),
        note: interview.interview_number,
      },
      { transaction }
    );

    return { interview };
  });

  // Phase 2 — update the external calendar event OUTSIDE the transaction, then patch.
  const { interview } = result;
  const round = resolveRound(interview.job, interview.stage_key, res);
  const interviewers = (interview.participants || [])
    .filter((p) => p.role === INTERVIEW_PARTICIPANT_ROLES.INTERVIEWER)
    .map((p) => ({ id: p.user_id, email: p.email, name: p.name }));
  const candidate = (interview.participants || []).find(
    (p) => p.role === INTERVIEW_PARTICIPANT_ROLES.CANDIDATE
  );

  const { provider, effectiveKey } = providerRegistry.resolve(interview.provider);
  try {
    const out = await provider.updateEvent(
      buildProviderContext(interview, round, interview.application, interviewers, candidate)
    );
    interview.external_event_id = out.external_event_id || interview.external_event_id;
    interview.meeting_url = out.meeting_url || interview.meeting_url;
    if (out.provider_meta) interview.provider_meta = out.provider_meta;
    await interview.save();
  } catch (err) {
    logger.error(`[interview] provider "${effectiveKey}" updateEvent failed: ${err.message}`);
  }

  notifyParticipants('interview_rescheduled', interview, round, interview.application, interviewers, candidate);

  return Interview.findOne({ where: { id: interview.id }, include: INTERVIEW_INCLUDE });
};

// ── Public: cancel + complete ─────────────────────────────────────────────────

const cancelInterview = async (uuid, payload, req, res) => {
  // Phase 1 — mark cancelled + audit atomically (no external HTTP under the lock).
  const result = await sequelize.transaction(async (transaction) => {
    const interview = await findVisibleInterview(uuid, req, res, { transaction, lock: true });
    if (INTERVIEW_TERMINAL_STATUSES.includes(interview.status)) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_not_active'));
    }
    interview.status = INTERVIEW_STATUSES.CANCELLED;
    interview.cancel_reason = payload.reason || null;
    await interview.save({ transaction });

    await ApplicationEvent.create(
      {
        organization_id: interview.organization_id,
        application_id: interview.application_id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.INTERVIEW_CANCELLED,
        from_value: interview.interview_number,
        to_value: null,
        note: payload.reason || null,
      },
      { transaction }
    );

    return { interview };
  });

  // Phase 2 — cancel the external calendar event OUTSIDE the transaction.
  const { interview } = result;
  const { provider, effectiveKey } = providerRegistry.resolve(interview.provider);
  try {
    await provider.cancelEvent({ externalEventId: interview.external_event_id });
  } catch (err) {
    logger.error(`[interview] provider "${effectiveKey}" cancelEvent failed: ${err.message}`);
  }

  const round = resolveRound(interview.job, interview.stage_key, res);
  const interviewers = (interview.participants || [])
    .filter((p) => p.role === INTERVIEW_PARTICIPANT_ROLES.INTERVIEWER)
    .map((p) => ({ email: p.email, name: p.name }));
  const candidate = (interview.participants || []).find(
    (p) => p.role === INTERVIEW_PARTICIPANT_ROLES.CANDIDATE
  );
  notifyParticipants('interview_cancelled', interview, round, interview.application, interviewers, candidate, {
    reason: payload.reason || '',
  });

  return Interview.findOne({ where: { id: interview.id }, include: INTERVIEW_INCLUDE });
};

/** Mark an interview completed (or no_show) and record the outcome. */
const completeInterview = async (uuid, payload, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const interview = await findVisibleInterview(uuid, req, res, { transaction, lock: true });
    if (INTERVIEW_TERMINAL_STATUSES.includes(interview.status)) {
      throw new ApiError(httpStatus.CONFLICT, res.__('interview_not_active'));
    }
    const nextStatus =
      payload.outcome === 'no_show' ? INTERVIEW_STATUSES.NO_SHOW : INTERVIEW_STATUSES.COMPLETED;
    interview.status = nextStatus;
    interview.outcome_note = payload.outcome_note || null;
    await interview.save({ transaction });

    await ApplicationEvent.create(
      {
        organization_id: interview.organization_id,
        application_id: interview.application_id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.INTERVIEW_COMPLETED,
        from_value: interview.interview_number,
        to_value: nextStatus,
        note: payload.outcome_note || null,
      },
      { transaction }
    );

    return Interview.findOne({ where: { id: interview.id }, include: INTERVIEW_INCLUDE, transaction });
  });
};

/** Which calendar providers the UI can offer (enabled/configured snapshot). */
const listProviders = () => providerRegistry.listAvailable();

module.exports = {
  listInterviewers,
  getAvailability,
  listForApplication,
  getInterviewByUuid,
  scheduleInterview,
  rescheduleInterview,
  cancelInterview,
  completeInterview,
  listProviders,
};
