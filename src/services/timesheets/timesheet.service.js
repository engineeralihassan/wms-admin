const httpStatus = require('http-status');
const { Op, literal } = require('sequelize');
const {
  sequelize,
  Timesheet,
  TimesheetEntry,
  Project,
  User,
  Organization,
  Attachment,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { TIMESHEET_QUERY_CONFIG } = require('../../config/query-configs');
const {
  TIMESHEET_STATUSES,
  OWNER_EDITABLE_STATUSES,
  TIMESHEET_DECISIONS,
  TIMESHEET_OWNER_TYPE,
  WEEK_HOURS_MAX,
} = require('../../utils/timesheet.constants');
const {
  toUtcDate,
  todayUtc,
  formatDate,
  weekWindow,
  weekDays,
} = require('../../utils/timesheet.date');
const projectService = require('../projects/project.service');
const attachmentService = require('../storage/attachment.service');
const emailService = require('../email/email.service');

// ── Attribute allow-lists & includes ────────────────────────────────────────

const TIMESHEET_ATTRIBUTES = [
  'id',
  'uuid',
  'timesheet_number',
  'organization_id',
  'project_id',
  'user_id',
  'reviewed_by_id',
  'week_start_date',
  'week_end_date',
  'due_date',
  'lock_date',
  'total_hours',
  'status',
  'submitted_at',
  'reviewed_at',
  'rejection_reason',
  'review_note',
  'auto_generated',
  'createdAt',
  'updatedAt',
];

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];
const PROJECT_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'project_code', 'name', 'status'];
const ENTRY_ATTRIBUTES = ['id', 'uuid', 'work_date', 'hours', 'note'];

const TIMESHEET_INCLUDE = [
  { model: User, as: 'owner', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: User, as: 'reviewer', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: Project, as: 'project', attributes: PROJECT_SUMMARY_ATTRIBUTES },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
  {
    model: TimesheetEntry,
    as: 'entries',
    attributes: ENTRY_ATTRIBUTES,
    separate: true,
    order: [['work_date', 'ASC']],
  },
];

// ── RBAC helpers ────────────────────────────────────────────────────────────

/**
 * Single source of truth for "does this actor approve timesheets org-wide". We check
 * the PERMISSION (timesheet.approve), not the role name, so any custom role granted it
 * behaves identically — consistent with expense.review / leave.approve.
 */
const isApprover = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.TIMESHEET_APPROVE);

/**
 * Builds the tenant + visibility where-clause for timesheet LIST/READ queries.
 * Fail-closed: requires the request to have passed through tenantScope. Org and user
 * ids come from the signed token, never the request body.
 *
 *   super_admin -> {}                              (all timesheets, all orgs)
 *   approver    -> { organization_id }             (all timesheets in their org)
 *   normal user -> { organization_id, user_id }    (only their own)
 */
const buildTimesheetScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }
  const scope = { ...tenantWhere };
  if (!isApprover(auth)) {
    scope.user_id = auth.userId;
  }
  return scope;
};

// ── Small helpers ───────────────────────────────────────────────────────────

const nextTimesheetNumber = async (transaction) => {
  const maxId = (await Timesheet.max('id', { transaction })) || 0;
  return `TS-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

/**
 * Recompute a timesheet's denormalized total_hours from its entries and persist it.
 * Kept in one place so every entry write path stays consistent. Runs inside the given
 * transaction so the cache can never drift from the rows.
 */
const recomputeTotal = async (timesheetId, transaction) => {
  const sum = await TimesheetEntry.sum('hours', {
    where: { timesheet_id: timesheetId },
    transaction,
  });
  const total = Math.round((Number(sum) || 0) * 100) / 100;
  await Timesheet.update({ total_hours: total }, { where: { id: timesheetId }, transaction });
  return total;
};

/**
 * Attach the polymorphic uploaded-file rows onto timesheet instances as
 * `timesheet_attachments`, batched by a single query (attachments are polymorphic, so
 * they can't be loaded via `include`). Mirrors the expense service.
 */
const withAttachments = async (timesheets) => {
  const list = Array.isArray(timesheets) ? timesheets : [timesheets].filter(Boolean);
  if (list.length === 0) return timesheets;

  const ids = list.map((t) => t.id);
  const rows = await Attachment.findAll({
    where: { owner_type: TIMESHEET_OWNER_TYPE, owner_id: ids },
    order: [['created_at', 'DESC']],
  });

  const byOwner = new Map();
  rows.forEach((r) => {
    const arr = byOwner.get(r.owner_id) || [];
    arr.push(attachmentService.toDto(r));
    byOwner.set(r.owner_id, arr);
  });

  list.forEach((t) => t.setDataValue('timesheet_attachments', byOwner.get(t.id) || []));
  return timesheets;
};

/** Load a timesheet by uuid within the caller's VISIBILITY scope (null => 404 later). */
const findVisibleTimesheet = async (uuid, req) => {
  const timesheet = await Timesheet.findOne({
    where: { uuid, ...buildTimesheetScope(req) },
    attributes: TIMESHEET_ATTRIBUTES,
    include: TIMESHEET_INCLUDE,
  });
  if (timesheet) await withAttachments(timesheet);
  return timesheet;
};

/**
 * Resolve a project by its public uuid within the caller's org, and confirm the target
 * user may log time against it. Returns the project row.
 *
 * Validity gate (as specified): a user may log time only if
 *   (a) they are an active member of the project (ProjectMember row), and
 *   (b) their contract window covers the week (contract not expired / not-yet-started).
 * Approvers/super_admins bypass the membership requirement so they can backfill on a
 * member's behalf, but the contract-window check still applies to the OWNER.
 */
const resolveLoggableProject = async (projectUuid, organizationId, ownerUserId, req, res) => {
  const project = await Project.findOne({
    where: { uuid: projectUuid, organization_id: organizationId },
    attributes: ['id', 'uuid', 'organization_id', 'name'],
  });
  if (!project) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_project_not_found'));
  }

  const actorIsApprover = isApprover(req.auth);
  const member = await projectService.isProjectMember(project.id, ownerUserId);
  if (!member && !actorIsApprover) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('timesheet_not_project_member'));
  }
  return project;
};

/**
 * Assert the owner's contract window (if configured on their profile) covers the whole
 * timesheet week. A missing contract date is treated as "open-ended" (no restriction),
 * matching how the profile is progressively filled. Throws otherwise.
 */
const assertContractCoversWeek = async (ownerUserId, weekStart, weekEnd, res, transaction) => {
  const owner = await User.findByPk(ownerUserId, {
    attributes: ['id'],
    include: [{ association: 'profile', attributes: ['contract_start_date', 'contract_end_date'] }],
    transaction,
  });
  const profile = owner && owner.profile;
  if (!profile) return; // no profile yet -> unrestricted

  const wkStart = toUtcDate(weekStart);
  const wkEnd = toUtcDate(weekEnd);

  if (profile.contract_start_date && toUtcDate(profile.contract_start_date) > wkEnd) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_contract_not_active'));
  }
  if (profile.contract_end_date && toUtcDate(profile.contract_end_date) < wkStart) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_contract_expired'));
  }
};

/** Is the timesheet past its lock date (relative to org "today", UTC)? */
const isLocked = (timesheet) =>
  timesheet.status === TIMESHEET_STATUSES.LOCKED ||
  toUtcDate(timesheet.lock_date) <= todayUtc();

/** May the OWNER edit this sheet right now? Editable status AND not past lock. */
const isOwnerEditable = (timesheet) =>
  OWNER_EDITABLE_STATUSES.includes(timesheet.status) && !isLocked(timesheet);

// ── Ensure / create a week's timesheet ──────────────────────────────────────

/**
 * Ensure a timesheet exists for (project, owner, week-containing `anyDateInWeek`) and
 * return it. This is the idempotent primitive behind both the explicit "create/open a
 * week" endpoint and the weekly auto-generator: the (project_id, user_id,
 * week_start_date) unique constraint guarantees at most one row, so a race just
 * re-reads the existing one.
 *
 * @param {object} opts { organizationId, projectId, ownerUserId, anyDateInWeek, autoGenerated, status }
 *   status defaults to UNSUBMITTED. The generator passes LOCKED when backfilling a past
 *   week whose lock date has already elapsed, so we never open a submittable window in
 *   the past.
 */
const ensureWeeklyTimesheet = async (opts, transaction) => {
  const { organizationId, projectId, ownerUserId, anyDateInWeek, autoGenerated } = opts;
  const status = opts.status || TIMESHEET_STATUSES.UNSUBMITTED;
  const window = weekWindow(anyDateInWeek);

  const existing = await Timesheet.findOne({
    where: {
      project_id: projectId,
      user_id: ownerUserId,
      week_start_date: window.weekStart,
    },
    transaction,
  });
  if (existing) return { timesheet: existing, created: false };

  const timesheet_number = await nextTimesheetNumber(transaction);
  let created;
  try {
    created = await Timesheet.create(
      {
        timesheet_number,
        organization_id: organizationId,
        project_id: projectId,
        user_id: ownerUserId,
        week_start_date: window.weekStart,
        week_end_date: window.weekEnd,
        due_date: window.dueDate,
        lock_date: window.lockDate,
        total_hours: 0,
        status,
        auto_generated: !!autoGenerated,
      },
      { transaction }
    );
  } catch (err) {
    // Lost a race on the unique key — re-read the winner.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const winner = await Timesheet.findOne({
        where: {
          project_id: projectId,
          user_id: ownerUserId,
          week_start_date: window.weekStart,
        },
        transaction,
      });
      if (winner) return { timesheet: winner, created: false };
    }
    throw err;
  }

  // Pre-seed the 7 empty daily entries so the UI always renders a full week and the
  // owner just fills in the numbers. bulkCreate with ignoreDuplicates is safe here.
  const days = weekDays(window.weekStart).map((d) => ({
    timesheet_id: created.id,
    organization_id: organizationId,
    work_date: formatDate(d),
    hours: 0,
    note: null,
  }));
  await TimesheetEntry.bulkCreate(days, { transaction, ignoreDuplicates: true });

  return { timesheet: created, created: true };
};

/**
 * Explicit "open this week's timesheet" endpoint. The owner (or an approver on a
 * member's behalf) picks a project and (optionally) a date in the target week; we
 * validate membership + contract, then ensure the sheet exists and return it.
 */
const createTimesheet = async (body, req, res) => {
  const { auth } = req;
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  // Owner is the caller. (Approvers backfilling for others go through the correction
  // endpoint; creation is always self-service to keep ownership unambiguous.)
  const ownerUserId = auth.userId;
  const anyDateInWeek = body.week_date ? formatDate(body.week_date) : formatDate(todayUtc());
  const window = weekWindow(anyDateInWeek);

  const timesheet = await sequelize.transaction(async (transaction) => {
    const project = await resolveLoggableProject(
      body.project,
      organizationId,
      ownerUserId,
      req,
      res
    );
    await assertContractCoversWeek(ownerUserId, window.weekStart, window.weekEnd, res, transaction);
    const { timesheet: ts } = await ensureWeeklyTimesheet(
      {
        organizationId,
        projectId: project.id,
        ownerUserId,
        anyDateInWeek,
        autoGenerated: false,
      },
      transaction
    );
    return ts;
  });

  return findVisibleTimesheet(timesheet.uuid, req);
};

// ── List / read ─────────────────────────────────────────────────────────────

const listTimesheets = async (req) => {
  const scopeWhere = buildTimesheetScope(req);

  // "mine" narrows an approver's view to their own sheets on top of base visibility.
  if (req.query.scope === 'mine') {
    scopeWhere.user_id = req.auth.userId;
  }

  const filters = (req.query.filters && { ...req.query.filters }) || {};

  // The client filters by project using its public uuid (ids are never exposed).
  // Resolve it to the numeric project_id and apply it as part of the security scope so
  // it can't be spoofed. An unknown/other-org uuid yields an impossible id (empty set).
  if (filters.project_id) {
    const project = await Project.findOne({
      where: { uuid: filters.project_id, organization_id: req.auth.organizationId },
      attributes: ['id'],
    });
    scopeWhere.project_id = project ? project.id : -1;
    delete filters.project_id;
  }

  const query = { ...req.query, filters };

  const result = await paginate(Timesheet, query, TIMESHEET_QUERY_CONFIG, {
    scopeWhere,
    attributes: TIMESHEET_ATTRIBUTES,
    include: TIMESHEET_INCLUDE,
  });

  await withAttachments(result.data);
  return result;
};

const getTimesheetByUuid = async (uuid, req, res) => {
  const timesheet = await findVisibleTimesheet(uuid, req);
  if (!timesheet) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
  }
  return timesheet;
};

// ── Save daily entries (draft) ──────────────────────────────────────────────

/**
 * Bulk-save the week's daily hours/notes ("Save as draft"). Owner-only, and only while
 * the sheet is unsubmitted/rejected AND not past its lock date. Each incoming entry is
 * keyed by work_date and MUST fall within the sheet's own week (no smuggling foreign
 * dates). The denormalized total is recomputed in the same transaction.
 */
const saveEntries = async (uuid, entries, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const timesheet = await Timesheet.findOne({
      where: { uuid, ...buildTimesheetScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!timesheet) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
    }
    if (timesheet.user_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (!isOwnerEditable(timesheet)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_not_editable'));
    }

    const validDates = new Set(weekDays(timesheet.week_start_date).map((d) => formatDate(d)));

    // Guard the weekly ceiling before writing (defense-in-depth over per-day bounds).
    const weekTotal = entries.reduce((n, e) => n + Number(e.hours || 0), 0);
    if (weekTotal > WEEK_HOURS_MAX) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_week_hours_exceeded'));
    }

    for (const entry of entries) {
      const workDate = formatDate(entry.work_date);
      if (!validDates.has(workDate)) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_date_out_of_week'));
      }
      // Upsert the day: update if it exists, otherwise create it. The
      // (timesheet_id, work_date) unique key makes this deterministic.
      // eslint-disable-next-line no-await-in-loop
      const [row, created] = await TimesheetEntry.findOrCreate({
        where: { timesheet_id: timesheet.id, work_date: workDate },
        defaults: {
          timesheet_id: timesheet.id,
          organization_id: timesheet.organization_id,
          work_date: workDate,
          hours: entry.hours ?? 0,
          note: entry.note ?? null,
        },
        transaction,
      });
      if (!created) {
        if (entry.hours !== undefined) row.hours = entry.hours;
        if (entry.note !== undefined) row.note = entry.note;
        // eslint-disable-next-line no-await-in-loop
        await row.save({ transaction });
      }
    }

    await recomputeTotal(timesheet.id, transaction);
    return findVisibleTimesheet(uuid, req);
  });
};

// ── Submit / withdraw ───────────────────────────────────────────────────────

/**
 * Submit the week for approval. Owner-only, from an editable status, before the lock
 * date. Recomputes the total, stamps submitted_at, clears any prior review fields, and
 * queues a notification to the org's approvers.
 */
const submitTimesheet = async (uuid, req, res) => {
  const timesheet = await sequelize.transaction(async (transaction) => {
    const ts = await Timesheet.findOne({
      where: { uuid, ...buildTimesheetScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!ts) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
    }
    if (ts.user_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (!OWNER_EDITABLE_STATUSES.includes(ts.status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_not_submittable'));
    }
    if (isLocked(ts)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_locked'));
    }

    await recomputeTotal(ts.id, transaction);
    ts.status = TIMESHEET_STATUSES.SUBMITTED;
    ts.submitted_at = new Date();
    ts.reviewed_by_id = null;
    ts.reviewed_at = null;
    ts.rejection_reason = null;
    await ts.save({ transaction });
    return ts;
  });

  await notifyApprovers('timesheet_submitted', timesheet, req);
  return findVisibleTimesheet(uuid, req);
};

/**
 * Withdraw a still-pending (submitted, not yet reviewed) sheet back to unsubmitted.
 * Owner-only, before the lock date. Matches the "Withdraw Timesheet" button.
 */
const withdrawTimesheet = async (uuid, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const ts = await Timesheet.findOne({
      where: { uuid, ...buildTimesheetScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!ts) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
    }
    if (ts.user_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (ts.status !== TIMESHEET_STATUSES.SUBMITTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_not_withdrawable'));
    }
    if (isLocked(ts)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_locked'));
    }

    ts.status = TIMESHEET_STATUSES.UNSUBMITTED;
    ts.submitted_at = null;
    await ts.save({ transaction });
    return findVisibleTimesheet(uuid, req);
  });
};

// ── Approver: review (approve / reject) ─────────────────────────────────────

/**
 * Approve or reject a SUBMITTED timesheet. Approver-only. Rejection requires a reason;
 * a rejected sheet returns to the owner for edit & resubmit. An approver cannot decide
 * their own timesheet (separation of duties). Notifies the owner either way.
 */
const reviewTimesheet = async (uuid, decision, rejectionReason, reviewNote, req, res) => {
  if (!isApprover(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const { timesheet, ownerEmail } = await sequelize.transaction(async (transaction) => {
    const ts = await Timesheet.findOne({
      where: { uuid, ...buildTimesheetScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!ts) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
    }
    if (ts.user_id === req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('timesheet_self_review'));
    }
    if (ts.status !== TIMESHEET_STATUSES.SUBMITTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_not_reviewable'));
    }

    if (decision === TIMESHEET_DECISIONS.APPROVE) {
      ts.status = TIMESHEET_STATUSES.APPROVED;
      ts.rejection_reason = null;
    } else {
      ts.status = TIMESHEET_STATUSES.REJECTED;
      ts.rejection_reason = rejectionReason;
    }
    ts.review_note = reviewNote ?? null;
    ts.reviewed_by_id = req.auth.userId;
    ts.reviewed_at = new Date();
    await ts.save({ transaction });

    const owner = await User.findByPk(ts.user_id, { attributes: ['email'], transaction });
    return { timesheet: ts, ownerEmail: owner ? owner.email : null };
  });

  const template =
    decision === TIMESHEET_DECISIONS.APPROVE ? 'timesheet_approved' : 'timesheet_rejected';
  await notifyOwner(template, timesheet, ownerEmail, req);
  return findVisibleTimesheet(uuid, req);
};

// ── Approver: correction (edit + accept, even after lock) ───────────────────

/**
 * Approver correction: edit a sheet's daily entries on the owner's behalf and
 * (optionally) set its status, WITH a note explaining the change. This is the path the
 * business described — "admin can change the timesheet and save this and accept it, and
 * send a notification of the change for correctness" — and it also backfills LOCKED
 * sheets. Approver-only. Notifies the owner about the correction.
 *
 * @param {object} body { entries?: [{work_date, hours?, note?}], status?: 'submitted'|'approved', review_note? }
 */
const correctTimesheet = async (uuid, body, req, res) => {
  if (!isApprover(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const { timesheet, ownerEmail } = await sequelize.transaction(async (transaction) => {
    const ts = await Timesheet.findOne({
      where: { uuid, ...buildTimesheetScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!ts) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
    }

    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length) {
      const validDates = new Set(weekDays(ts.week_start_date).map((d) => formatDate(d)));
      for (const entry of entries) {
        const workDate = formatDate(entry.work_date);
        if (!validDates.has(workDate)) {
          throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_date_out_of_week'));
        }
        // eslint-disable-next-line no-await-in-loop
        const [row, created] = await TimesheetEntry.findOrCreate({
          where: { timesheet_id: ts.id, work_date: workDate },
          defaults: {
            timesheet_id: ts.id,
            organization_id: ts.organization_id,
            work_date: workDate,
            hours: entry.hours ?? 0,
            note: entry.note ?? null,
          },
          transaction,
        });
        if (!created) {
          if (entry.hours !== undefined) row.hours = entry.hours;
          if (entry.note !== undefined) row.note = entry.note;
          // eslint-disable-next-line no-await-in-loop
          await row.save({ transaction });
        }
      }
      await recomputeTotal(ts.id, transaction);
    }

    // Optional status move by the approver (e.g. accept a locked/backfilled sheet).
    if (body.status === TIMESHEET_STATUSES.SUBMITTED || body.status === TIMESHEET_STATUSES.APPROVED) {
      ts.status = body.status;
      if (body.status === TIMESHEET_STATUSES.APPROVED) {
        ts.rejection_reason = null;
      }
    }
    ts.review_note = body.review_note ?? ts.review_note;
    ts.reviewed_by_id = req.auth.userId;
    ts.reviewed_at = new Date();
    await ts.save({ transaction });

    const owner = await User.findByPk(ts.user_id, { attributes: ['email'], transaction });
    return { timesheet: ts, ownerEmail: owner ? owner.email : null };
  });

  await notifyOwner('timesheet_corrected', timesheet, ownerEmail, req);
  return findVisibleTimesheet(uuid, req);
};

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a timesheet. Owner may delete their OWN sheet only while it's unsubmitted/
 * rejected and not locked; approvers may delete any visible sheet in their org. The
 * daily entries cascade with the parent (FK onDelete CASCADE).
 */
const deleteTimesheet = async (uuid, req, res) => {
  const timesheet = await findVisibleTimesheet(uuid, req);
  if (!timesheet) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('timesheet_not_found'));
  }
  const approver = isApprover(req.auth);
  const isOwner = timesheet.user_id === req.auth.userId;

  if (!approver && !isOwner) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  if (!approver && !isOwnerEditable(timesheet)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('timesheet_not_deletable'));
  }

  await sequelize.transaction(async (transaction) => {
    await TimesheetEntry.destroy({ where: { timesheet_id: timesheet.id }, transaction });
    await Timesheet.destroy({ where: { id: timesheet.id }, transaction });
  });
  return true;
};

// ── Project picker ──────────────────────────────────────────────────────────

/**
 * The timesheet project picker: the projects the caller may log time against. Reuses
 * the project service's membership-scoped "my projects" list, so there is exactly one
 * definition of "projects I belong to".
 */
const listLoggableProjects = async (req) => projectService.listMine(req);

// ── Notifications (fire-and-forget) ─────────────────────────────────────────

/**
 * Notify the org's approvers about a timesheet event (currently: submission). We email
 * users in the org who hold timesheet.approve — resolved via their role's permissions.
 * Fire-and-forget through the durable email queue so it never blocks the request.
 */
const notifyApprovers = async (template, timesheet, req) => {
  try {
    const approvers = await User.findAll({
      where: { organization_id: timesheet.organization_id, status: 'active' },
      attributes: ['email'],
      include: [
        {
          association: 'role',
          required: true,
          include: [
            {
              association: 'permissions',
              required: true,
              where: { key: PERMISSIONS.TIMESHEET_APPROVE },
              attributes: [],
            },
          ],
          attributes: [],
        },
      ],
    });
    const data = buildEmailData(timesheet, req);
    approvers.forEach((a) => {
      if (a.email) emailService.enqueueSafe(template, a.email, data);
    });
  } catch {
    // Notification failure must never affect the primary action.
  }
};

/** Notify the timesheet owner about a review/correction event. */
const notifyOwner = async (template, timesheet, ownerEmail, req) => {
  if (!ownerEmail) return;
  emailService.enqueueSafe(template, ownerEmail, buildEmailData(timesheet, req));
};

/** Shared email payload for timesheet notifications. */
const buildEmailData = (timesheet, req) => ({
  timesheetNumber: timesheet.timesheet_number,
  weekStart: timesheet.week_start_date,
  weekEnd: timesheet.week_end_date,
  totalHours: Number(timesheet.total_hours) || 0,
  status: timesheet.status,
  rejectionReason: timesheet.rejection_reason || null,
  reviewNote: timesheet.review_note || null,
  clientUrl: process.env.CLIENT_URL || '',
});

module.exports = {
  // scope / helpers (also used by the generator + tests)
  isApprover,
  buildTimesheetScope,
  ensureWeeklyTimesheet,
  recomputeTotal,
  // CRUD + workflow
  createTimesheet,
  listTimesheets,
  getTimesheetByUuid,
  saveEntries,
  submitTimesheet,
  withdrawTimesheet,
  reviewTimesheet,
  correctTimesheet,
  deleteTimesheet,
  listLoggableProjects,
};
