const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  Job,
  JobApplication,
  ApplicationEvent,
  User,
  Organization,
  Attachment,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { APPLICATION_QUERY_CONFIG } = require('../../config/query-configs');
const attachmentService = require('../storage/attachment.service');
const fileService = require('../storage/file.service');
const resumeScreeningService = require('./resume/resume-screening.service');
const { config, UPLOAD_FOLDERS } = require('../../config/storage');
const {
  JOB_STATUSES,
  JOB_PUBLIC_OPEN_STATUSES,
  JOB_CLOSED_REASONS,
  APPLICATION_STATUSES,
  APPLICATION_SOURCES,
  APPLICATION_TRANSITIONS,
  APPLICATION_INTERRUPTIBLE_STATUSES,
  APPLICATION_TERMINAL_STATUSES,
  APPLICATION_EVENT_TYPES,
  APPLICATION_ATTACHMENT_OWNER_TYPE,
  APPLICATION_MAX_FILES,
  SCREENING_STATUSES,
  SCREENING_RANK_DEFAULT_LIMIT,
  SCREENING_RANK_MAX_LIMIT,
} = require('../../utils/ats.constants');
const { config: aiConfig } = require('../../config/ai');
const { buildJobScope, nextSequenceCode } = require('./ats.shared');

/**
 * application.service — business logic for candidate applications.
 *
 * Two audiences:
 *   PUBLIC (no auth)   — getPublicJob + apply: the careers page. Reads only OPEN jobs;
 *                        creates applications and attaches the uploaded CV.
 *   RECRUITER (auth)   — list/read/status/rating/notes/delete: scoped so a recruiter
 *                        only touches applications to jobs they own; an org admin sees
 *                        all. Every workflow change appends an immutable event row.
 */

const APPLICATION_ATTRIBUTES = [
  'id',
  'uuid',
  'application_number',
  'organization_id',
  'job_id',
  'reviewed_by_id',
  'candidate_name',
  'candidate_email',
  'candidate_phone',
  'linkedin_url',
  'portfolio_url',
  'experience_years',
  'cover_note',
  'status',
  'stage_key',
  'rating',
  'decision_reason',
  'source',
  'submitted_at',
  'screening_status',
  'screening_score',
  'screening_band',
  'screening_breakdown',
  'screened_at',
  'createdAt',
  'updatedAt',
];

const APPLICATION_INCLUDE = [
  {
    model: Job,
    as: 'job',
    attributes: ['uuid', 'job_code', 'title', 'status', 'interview_rounds', 'created_by_id'],
  },
  { model: User, as: 'reviewer', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
];

// ── PUBLIC: careers page ──────────────────────────────────────────────────────

/**
 * Resolve a public job by its shareable token for the careers page.
 * Returns { job, available, reason }:
 *   - DRAFT / unknown token -> 404 (never leak an unpublished job).
 *   - OPEN                  -> available:true.
 *   - CLOSED / FILLED       -> available:false with a reason for the friendly message.
 */
const getPublicJobByToken = async (token, res) => {
  const job = await Job.findOne({
    where: { public_token: token },
    include: [{ model: Organization, as: 'organization', attributes: ['uuid', 'name', 'slug'] }],
  });
  // Treat missing OR still-draft jobs as not found so unpublished jobs never leak.
  if (!job || job.status === JOB_STATUSES.DRAFT) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('job_not_found'));
  }

  const available = JOB_PUBLIC_OPEN_STATUSES.includes(job.status);
  let reason = null;
  if (!available) {
    reason =
      job.status === JOB_STATUSES.FILLED ? JOB_CLOSED_REASONS.FILLED : JOB_CLOSED_REASONS.CLOSED;
  }
  return { job, available, reason };
};

/**
 * Submit a public application against a job token. Multipart: candidate text fields in
 * `body`, CV/attachments in the request files (already size/mime-checked by multer).
 *
 * Flow (transactional for the DB rows; file bytes are uploaded first, and rolled back
 * if the DB write fails so we never orphan objects):
 *   1. Resolve an OPEN job by token (reject if not accepting applications).
 *   2. Require at least one uploaded file (the CV).
 *   3. Create the application (status NEW) + the initial CREATED event.
 *   4. Attach the uploaded files to the application (owner_type='job_application').
 */
const applyToJob = async (token, body, req, res) => {
  const { job, available } = await getPublicJobByToken(token, res);
  if (!available) {
    throw new ApiError(httpStatus.CONFLICT, res.__('job_not_accepting'));
  }

  const files = fileService.collectFiles(req);
  if (!files.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('application_cv_required'));
  }
  if (files.length > APPLICATION_MAX_FILES) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('application_too_many_files'));
  }

  // Upload bytes to the provider BEFORE opening the DB transaction (they live outside
  // Postgres). If the DB write fails we remove them so nothing is orphaned.
  const descriptors = await fileService.uploadFromRequest(req, {
    folder: UPLOAD_FOLDERS.RESUMES,
  });

  try {
    const application = await sequelize.transaction(async (transaction) => {
      const application_number = await nextSequenceCode(JobApplication, 'APP', transaction);
      const created = await JobApplication.create(
        {
          application_number,
          organization_id: job.organization_id,
          job_id: job.id,
          candidate_name: body.candidate_name,
          candidate_email: body.candidate_email,
          candidate_phone: body.candidate_phone || null,
          linkedin_url: body.linkedin_url || null,
          portfolio_url: body.portfolio_url || null,
          experience_years: body.experience_years ?? null,
          cover_note: body.cover_note || null,
          status: APPLICATION_STATUSES.NEW,
          source: APPLICATION_SOURCES.CAREERS_PAGE,
          submitted_at: new Date(),
        },
        { transaction }
      );

      await ApplicationEvent.create(
        {
          organization_id: job.organization_id,
          application_id: created.id,
          created_by_id: null, // public/candidate action
          entry_type: APPLICATION_EVENT_TYPES.CREATED,
          from_value: null,
          to_value: APPLICATION_STATUSES.NEW,
          note: null,
        },
        { transaction }
      );

      // Persist the attachment rows (bytes already uploaded above).
      const rows = descriptors.map((d) => ({
        owner_type: APPLICATION_ATTACHMENT_OWNER_TYPE,
        owner_id: created.id,
        organization_id: job.organization_id,
        field_name: d.field || 'cv',
        storage_key: d.key,
        storage_driver: config.driver,
        url: d.url,
        file_name: d.name,
        file_mime: d.mime,
        file_size: d.size,
        uploaded_by_id: null,
      }));
      await Attachment.bulkCreate(rows, { transaction });

      return created;
    });

    // Screen the CV asynchronously (once). Fire-and-forget AFTER commit so a queue or
    // provider hiccup can never affect the candidate's submission.
    resumeScreeningService.enqueueSafe(application.id, {
      organizationId: job.organization_id,
      reason: 'apply',
    });

    // Public-safe acknowledgement only (never leak internal ids or org data).
    return {
      application_number: application.application_number,
      candidate_name: application.candidate_name,
      job_title: job.title,
    };
  } catch (err) {
    await fileService.removeMany(descriptors.map((d) => d.key));
    throw err;
  }
};

// ── RECRUITER: management ─────────────────────────────────────────────────────

/**
 * Resolve a job the caller may manage (own job, or any if org admin) by uuid. Used by
 * the "applications for a job" list. Throws 404 if not visible.
 */
const resolveOwnedJob = async (jobUuid, req, res, transaction) => {
  const job = await Job.findOne({
    where: { uuid: jobUuid, ...buildJobScope(req) },
    transaction,
  });
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('job_not_found'));
  }
  return job;
};

/** List applications for a specific job (tenant + ownership scoped through the job). */
const listApplicationsForJob = async (jobUuid, req, res) => {
  const job = await resolveOwnedJob(jobUuid, req, res);
  return paginate(JobApplication, req.query, APPLICATION_QUERY_CONFIG, {
    scopeWhere: { organization_id: job.organization_id, job_id: job.id },
    attributes: APPLICATION_ATTRIBUTES,
    include: APPLICATION_INCLUDE,
  });
};

/**
 * Ranked (top-N) applications for a job, ordered by cached screening_score DESC. This
 * reads the score already computed by the resume worker — no AI call happens here, so
 * it stays instant even with thousands of applicants. Only screened candidates with a
 * score are ranked; unscored/failed/skipped are reported separately for transparency.
 *
 * @returns {{ items, total_ranked, screening: { enabled, done, pending, processing,
 *             failed, skipped } }}
 */
const listRankedApplications = async (jobUuid, req, res) => {
  const job = await resolveOwnedJob(jobUuid, req, res);

  const requested = Number(req.query.limit) || SCREENING_RANK_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, requested), SCREENING_RANK_MAX_LIMIT);

  const baseWhere = { organization_id: job.organization_id, job_id: job.id };

  // The ranked list: screened candidates that have a numeric score, best first.
  // NULLS LAST is implicit because we filter to non-null scores.
  const rows = await JobApplication.findAll({
    where: { ...baseWhere, screening_score: { [Op.ne]: null } },
    attributes: APPLICATION_ATTRIBUTES,
    include: APPLICATION_INCLUDE,
    order: [
      ['screening_score', 'DESC'],
      ['rating', 'DESC'],
      ['created_at', 'ASC'],
    ],
    limit,
  });

  // Pipeline health so the UI can show "12 of 200 screened, 5 pending…".
  const grouped = await JobApplication.findAll({
    where: baseWhere,
    attributes: [
      'screening_status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['screening_status'],
    raw: true,
  });
  const counts = grouped.reduce((acc, g) => {
    acc[g.screening_status] = Number(g.count);
    return acc;
  }, {});

  return {
    items: rows,
    limit,
    total_ranked: rows.length,
    screening: {
      enabled: aiConfig.enabled,
      done: counts[SCREENING_STATUSES.DONE] || 0,
      pending: counts[SCREENING_STATUSES.PENDING] || 0,
      processing: counts[SCREENING_STATUSES.PROCESSING] || 0,
      failed: counts[SCREENING_STATUSES.FAILED] || 0,
      skipped: counts[SCREENING_STATUSES.SKIPPED] || 0,
    },
  };
};

/**
 * Fetch an application the caller may see. Visibility is enforced by joining to the
 * parent job under the caller's job scope (recruiter -> own jobs, admin -> all).
 */
const findVisibleApplication = async (uuid, req, res, transaction) => {
  const application = await JobApplication.findOne({
    where: { uuid, ...req.tenantWhere },
    attributes: APPLICATION_ATTRIBUTES,
    include: [
      {
        model: Job,
        as: 'job',
        attributes: [
          'id',
          'uuid',
          'job_code',
          'title',
          'status',
          'interview_rounds',
          'created_by_id',
        ],
        required: true,
      },
      { model: User, as: 'reviewer', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
    ],
    transaction,
  });
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
  }
  // Ownership overlay: a recruiter may only touch applications to jobs they created.
  const jobScope = buildJobScope(req);
  if (jobScope.created_by_id !== undefined && application.job.created_by_id !== jobScope.created_by_id) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
  }
  return application;
};

/** Read one application with its attachments (CVs) and event history. */
const getApplicationByUuid = async (uuid, req, res) => {
  const application = await findVisibleApplication(uuid, req, res);
  const attachments = await attachmentService.listForOwner(
    APPLICATION_ATTACHMENT_OWNER_TYPE,
    application.id,
    { organization_id: application.organization_id }
  );
  const events = await ApplicationEvent.findAll({
    where: { application_id: application.id },
    include: [{ model: User, as: 'actor', attributes: ['uuid', 'first_name', 'last_name'] }],
    order: [['created_at', 'ASC']],
  });
  return { application, attachments, events };
};

/**
 * Is a target status reachable from the current one?
 *   - Normal forward transitions come from APPLICATION_TRANSITIONS.
 *   - REJECTED / ON_HOLD are reachable from any non-terminal (interruptible) status.
 */
const canTransition = (from, to) => {
  if (APPLICATION_TERMINAL_STATUSES.includes(from)) return false;
  if (
    (to === APPLICATION_STATUSES.REJECTED || to === APPLICATION_STATUSES.ON_HOLD) &&
    APPLICATION_INTERRUPTIBLE_STATUSES.includes(from)
  ) {
    return true;
  }
  return (APPLICATION_TRANSITIONS[from] || []).includes(to);
};

/**
 * Move an application through its lifecycle and log an event. Uses a row lock so
 * concurrent recruiters can't race a transition.
 *   - INTERVIEWING requires a stage_key that exists in the job's pipeline.
 *   - REJECTED requires a decision_reason.
 *   - Sets reviewed_by_id to the acting user.
 */
const changeStatus = async (uuid, payload, req, res) => {
  const { status: nextStatus, stage_key: stageKey, decision_reason: reason, note } = payload;

  await sequelize.transaction(async (transaction) => {
    const application = await JobApplication.findOne({
      where: { uuid, ...req.tenantWhere },
      include: [
        {
          model: Job,
          as: 'job',
          attributes: ['id', 'created_by_id', 'interview_rounds'],
          required: true,
        },
      ],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!application) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
    }

    // Ownership overlay for recruiters.
    const jobScope = buildJobScope(req);
    if (
      jobScope.created_by_id !== undefined &&
      application.job.created_by_id !== jobScope.created_by_id
    ) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('application_not_found'));
    }

    const current = application.status;
    const currentStage = application.stage_key;

    // Advancing within interviewing (same status, different round) is allowed.
    const stageOnlyMove =
      nextStatus === APPLICATION_STATUSES.INTERVIEWING &&
      current === APPLICATION_STATUSES.INTERVIEWING;

    if (!stageOnlyMove && !canTransition(current, nextStatus)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('application_invalid_transition'));
    }

    // Validate the interview round against the job's pipeline.
    let resolvedStage = null;
    if (nextStatus === APPLICATION_STATUSES.INTERVIEWING) {
      const rounds = Array.isArray(application.job.interview_rounds)
        ? application.job.interview_rounds
        : [];
      const round = rounds.find((r) => r.key === stageKey);
      if (!round) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('application_invalid_stage'));
      }
      resolvedStage = round.key;
    }

    // Apply the change.
    application.status = nextStatus;
    application.stage_key =
      nextStatus === APPLICATION_STATUSES.INTERVIEWING ? resolvedStage : null;
    application.reviewed_by_id = req.auth.userId;
    if (nextStatus === APPLICATION_STATUSES.REJECTED || nextStatus === APPLICATION_STATUSES.ON_HOLD) {
      application.decision_reason = reason || null;
    }
    await application.save({ transaction });

    // Event: a stage-only move logs STAGE_CHANGED; anything else logs STATUS_CHANGED.
    if (stageOnlyMove) {
      await ApplicationEvent.create(
        {
          organization_id: application.organization_id,
          application_id: application.id,
          created_by_id: req.auth.userId,
          entry_type: APPLICATION_EVENT_TYPES.STAGE_CHANGED,
          from_value: currentStage,
          to_value: resolvedStage,
          note: note || null,
        },
        { transaction }
      );
    } else {
      await ApplicationEvent.create(
        {
          organization_id: application.organization_id,
          application_id: application.id,
          created_by_id: req.auth.userId,
          entry_type: APPLICATION_EVENT_TYPES.STATUS_CHANGED,
          from_value: current,
          to_value: nextStatus,
          note: note || reason || null,
        },
        { transaction }
      );
      // If we entered interviewing at a specific round, also record the stage.
      if (nextStatus === APPLICATION_STATUSES.INTERVIEWING) {
        await ApplicationEvent.create(
          {
            organization_id: application.organization_id,
            application_id: application.id,
            created_by_id: req.auth.userId,
            entry_type: APPLICATION_EVENT_TYPES.STAGE_CHANGED,
            from_value: currentStage,
            to_value: resolvedStage,
            note: null,
          },
          { transaction }
        );
      }
    }
  });

  return getApplicationByUuid(uuid, req, res);
};

/** Set/update the candidate rating (1–5) and log an event. */
const rateApplication = async (uuid, rating, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const application = await findVisibleApplication(uuid, req, res, transaction);
    const previous = application.rating;
    application.rating = rating;
    application.reviewed_by_id = req.auth.userId;
    await application.save({ transaction });
    await ApplicationEvent.create(
      {
        organization_id: application.organization_id,
        application_id: application.id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.RATING_UPDATED,
        from_value: previous != null ? String(previous) : null,
        to_value: String(rating),
        note: null,
      },
      { transaction }
    );
  });
  return getApplicationByUuid(uuid, req, res);
};

/** Append an internal note (writes a NOTE_ADDED event). */
const addNote = async (uuid, note, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const application = await findVisibleApplication(uuid, req, res, transaction);
    await ApplicationEvent.create(
      {
        organization_id: application.organization_id,
        application_id: application.id,
        created_by_id: req.auth.userId,
        entry_type: APPLICATION_EVENT_TYPES.NOTE_ADDED,
        from_value: null,
        to_value: null,
        note,
      },
      { transaction }
    );
  });
  return getApplicationByUuid(uuid, req, res);
};

/**
 * Delete an application and its stored files (CVs). Removes attachment objects from the
 * store and their rows, then the application and its events.
 */
const deleteApplication = async (uuid, req, res) => {
  const application = await findVisibleApplication(uuid, req, res);
  const attachments = await Attachment.findAll({
    where: {
      owner_type: APPLICATION_ATTACHMENT_OWNER_TYPE,
      owner_id: application.id,
      organization_id: application.organization_id,
    },
  });

  await sequelize.transaction(async (transaction) => {
    await ApplicationEvent.destroy({ where: { application_id: application.id }, transaction });
    await Attachment.destroy({
      where: {
        owner_type: APPLICATION_ATTACHMENT_OWNER_TYPE,
        owner_id: application.id,
        organization_id: application.organization_id,
      },
      transaction,
    });
    await JobApplication.destroy({ where: { id: application.id }, transaction });
  });

  // Remove the stored objects after the DB rows are gone (best-effort).
  await fileService.removeMany(attachments.map((a) => a.storage_key));
};

module.exports = {
  APPLICATION_ATTRIBUTES,
  getPublicJobByToken,
  applyToJob,
  listApplicationsForJob,
  listRankedApplications,
  getApplicationByUuid,
  findVisibleApplication,
  changeStatus,
  rateApplication,
  addNote,
  deleteApplication,
};
