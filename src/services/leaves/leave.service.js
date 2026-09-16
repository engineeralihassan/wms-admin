const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  sequelize,
  LeaveRequest,
  LeaveType,
  LeaveBalance,
  LeaveBalanceLedger,
  User,
  Organization,
  Attachment,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const attachmentService = require('../storage/attachment.service');
const { UPLOAD_FOLDERS } = require('../../config/storage');

/** owner_type used to key leave files in the polymorphic attachments table. */
const LEAVE_OWNER_TYPE = 'leave';
const {
  LEAVE_QUERY_CONFIG,
  LEAVE_BALANCE_QUERY_CONFIG,
} = require('../../config/query-configs');
const {
  LEAVE_STATUSES,
  LEAVE_ACTIVE_STATUSES,
  LEAVE_DAY_PORTIONS,
  LEAVE_DECISIONS,
  LEAVE_LEDGER_ENTRY_TYPES,
  DEFAULT_LEAVE_TYPES,
} = require('../../utils/leave.constants');
const {
  todayUtc,
  toUtcDate,
  formatDate,
  computeTotalDays,
  rangesOverlap,
  eachDay,
  isWeekend,
} = require('../../utils/leave.date');

// ── Attribute allow-lists & includes ────────────────────────────────────────

const LEAVE_ATTRIBUTES = [
  'id',
  'uuid',
  'leave_number',
  'organization_id',
  'created_by_id',
  'reviewed_by_id',
  'leave_type_id',
  'start_date',
  'end_date',
  'day_portion',
  'total_days',
  'reason',
  'status',
  'attachments',
  'submitted_at',
  'reviewed_at',
  'rejection_reason',
  'createdAt',
  'updatedAt',
];

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];
const LEAVE_TYPE_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'key', 'name', 'is_paid', 'requires_balance', 'color'];

const LEAVE_INCLUDE = [
  { model: User, as: 'applicant', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: User, as: 'reviewer', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: LeaveType, as: 'leaveType', attributes: LEAVE_TYPE_SUMMARY_ATTRIBUTES },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
];

// ── RBAC helpers ────────────────────────────────────────────────────────────

/**
 * Single source of truth for "does this actor approve leave org-wide". Mirrors
 * isReviewer in the expense service — we check the PERMISSION, not the role name,
 * so any custom role granted leave.approve behaves the same way.
 */
const isApprover = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.LEAVE_APPROVE);

/** Can this actor manage leave types / allocate balances? */
const isAllocator = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.LEAVE_ALLOCATE);

/**
 * Builds the tenant + visibility where-clause for leave LIST/READ queries. Fail-closed:
 * requires the request to have passed through the tenantScope middleware. Org and user
 * ids come from the signed token, never the request body.
 *
 *   super_admin  -> {}                                  (all leave, all orgs)
 *   approver     -> { organization_id }                 (all leave in their org)
 *   normal user  -> { organization_id, created_by_id }  (only their own requests)
 */
const buildLeaveScope = (req) => {
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
    scope.created_by_id = auth.userId;
  }
  return scope;
};

// ── Small helpers ───────────────────────────────────────────────────────────

const nextLeaveNumber = async (transaction) => {
  const maxId = (await LeaveRequest.max('id', { transaction })) || 0;
  return `LV-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

const normalizeAttachments = (attachments) =>
  Array.isArray(attachments) ? attachments.map((a) => ({ name: String(a.name).trim() })) : [];

/**
 * Attach the real uploaded-file rows (polymorphic attachments) onto leave instances
 * as `leave_attachments`, batched by a single query. Because attachments are
 * polymorphic (no Sequelize association), we load them here rather than via `include`.
 * Mutates and returns the same instances for convenience. Mirrors the expense service.
 */
const withAttachments = async (leaves) => {
  const list = Array.isArray(leaves) ? leaves : [leaves].filter(Boolean);
  if (list.length === 0) return leaves;

  const ids = list.map((l) => l.id);
  const rows = await Attachment.findAll({
    where: { owner_type: LEAVE_OWNER_TYPE, owner_id: ids },
    order: [['created_at', 'DESC']],
  });

  const byOwner = new Map();
  rows.forEach((r) => {
    const arr = byOwner.get(r.owner_id) || [];
    arr.push(attachmentService.toDto(r));
    byOwner.set(r.owner_id, arr);
  });

  list.forEach((l) => {
    // setDataValue so the extra field survives toJSON/serialization.
    l.setDataValue('leave_attachments', byOwner.get(l.id) || []);
  });
  return leaves;
};

const findVisibleLeave = async (uuid, req) => {
  const leave = await LeaveRequest.findOne({
    where: { uuid, ...buildLeaveScope(req) },
    attributes: LEAVE_ATTRIBUTES,
    include: LEAVE_INCLUDE,
  });
  if (leave) await withAttachments(leave);
  return leave;
};

/** Resolve a leave type uuid to an active type in the caller's organization. */
const resolveLeaveType = async (leaveTypeUuid, organizationId, res, transaction) => {
  const type = await LeaveType.findOne({
    where: { uuid: leaveTypeUuid, organization_id: organizationId, is_active: true },
    transaction,
  });
  if (!type) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_type_not_found'));
  }
  return type;
};

/**
 * Validate the date range against business rules:
 *   - end >= start
 *   - start is not in the past (org "today", UTC)
 *   - at least one business day in range (can't take leave over only weekends)
 *   - half-day portion only on a single-day request
 */
const validateDates = (startDate, endDate, dayPortion, res) => {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);

  if (end < start) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_invalid_range'));
  }
  if (start < todayUtc()) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_past_date'));
  }
  const businessDays = eachDay(start, end).filter((d) => !isWeekend(d)).length;
  if (businessDays === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_no_business_days'));
  }
  if (dayPortion !== LEAVE_DAY_PORTIONS.FULL && formatDate(start) !== formatDate(end)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_half_day_single_only'));
  }
};

/**
 * Ensure the applicant has no other ACTIVE (submitted/approved) request overlapping
 * the given range. Excludes the request being edited (excludeId).
 */
const assertNoOverlap = async (userId, organizationId, startDate, endDate, excludeId, res, transaction) => {
  const where = {
    organization_id: organizationId,
    created_by_id: userId,
    status: { [Op.in]: LEAVE_ACTIVE_STATUSES },
    // DB-level range overlap: existing.start <= new.end AND existing.end >= new.start
    start_date: { [Op.lte]: formatDate(endDate) },
    end_date: { [Op.gte]: formatDate(startDate) },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const clash = await LeaveRequest.findOne({ where, transaction });
  if (clash) {
    // Defensive double-check on exact overlap (DATEONLY comparison above is sufficient,
    // this keeps intent explicit and guards against tz edge cases).
    if (rangesOverlap(clash.start_date, clash.end_date, startDate, endDate)) {
      throw new ApiError(httpStatus.CONFLICT, res.__('leave_overlap'));
    }
  }
};

// ── Balance operations (transactional, row-locked) ──────────────────────────

/**
 * Find (locked) or create the balance row for a user/type/year. The row lock
 * (SELECT ... FOR UPDATE) serializes concurrent submissions so two requests can't
 * both pass the available-days check and overspend the balance.
 */
const findOrCreateBalanceLocked = async (
  { organizationId, userId, leaveTypeId, year, createdById },
  transaction
) => {
  let balance = await LeaveBalance.findOne({
    where: {
      organization_id: organizationId,
      user_id: userId,
      leave_type_id: leaveTypeId,
      period_year: year,
    },
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!balance) {
    balance = await LeaveBalance.create(
      {
        organization_id: organizationId,
        user_id: userId,
        leave_type_id: leaveTypeId,
        period_year: year,
        allocated: 0,
        used: 0,
        pending: 0,
        created_by_id: createdById,
      },
      { transaction }
    );
  }
  return balance;
};

const availableDays = (balance) =>
  Number(balance.allocated) - Number(balance.used) - Number(balance.pending);

/** Append an immutable ledger entry recording a balance movement. */
const writeLedger = async (
  { organizationId, balanceId, requestId, entryType, amount, balanceAfter, createdById },
  transaction
) =>
  LeaveBalanceLedger.create(
    {
      organization_id: organizationId,
      leave_balance_id: balanceId,
      leave_request_id: requestId ?? null,
      entry_type: entryType,
      amount,
      balance_after: balanceAfter,
      created_by_id: createdById ?? null,
    },
    { transaction }
  );

// ── Create / list / read / update / delete ──────────────────────────────────

/**
 * Create a leave request as a draft, or submit it immediately when action==='submit'.
 * organization_id + created_by_id come from the token. On immediate submit, the paid
 * balance is checked and held inside the same transaction.
 */
const createLeave = async (body, req, res) => {
  const { auth } = req;
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  const dayPortion = body.day_portion || LEAVE_DAY_PORTIONS.FULL;
  validateDates(body.start_date, body.end_date, dayPortion, res);

  const submit = body.action === 'submit';
  const totalDays = computeTotalDays(body.start_date, body.end_date, dayPortion);

  const created = await sequelize.transaction(async (transaction) => {
    const type = await resolveLeaveType(body.leave_type, organizationId, res, transaction);

    if (submit) {
      await assertNoOverlap(
        auth.userId,
        organizationId,
        body.start_date,
        body.end_date,
        null,
        res,
        transaction
      );
    }

    const leave_number = await nextLeaveNumber(transaction);
    const request = await LeaveRequest.create(
      {
        leave_number,
        organization_id: organizationId,
        created_by_id: auth.userId,
        leave_type_id: type.id,
        start_date: formatDate(body.start_date),
        end_date: formatDate(body.end_date),
        day_portion: dayPortion,
        total_days: totalDays,
        reason: body.reason ?? null,
        attachments: normalizeAttachments(body.attachments),
        status: submit ? LEAVE_STATUSES.SUBMITTED : LEAVE_STATUSES.DRAFT,
        submitted_at: submit ? new Date() : null,
      },
      { transaction }
    );

    if (submit) {
      await holdBalanceForRequest(request, type, req, transaction, res);
    }
    return request;
  });

  return findVisibleLeave(created.uuid, req);
};

const listLeaves = async (req) => {
  const scopeWhere = buildLeaveScope(req);
  if (req.query.scope === 'mine') {
    scopeWhere.created_by_id = req.auth.userId;
  }

  const filters = (req.query.filters && { ...req.query.filters }) || {};

  // The client filters by leave type using its public uuid (ids are never exposed in
  // DTOs). Resolve that uuid to the numeric leave_type_id and apply it as part of the
  // security scope, so it can't be spoofed and doesn't rely on the generic filter
  // layer (which only does exact matches on the raw column). An unknown/other-org uuid
  // yields an impossible id so the result is safely empty.
  const leaveTypeUuid = filters.leave_type;
  if (leaveTypeUuid) {
    const type = await LeaveType.findOne({
      where: { uuid: leaveTypeUuid, organization_id: req.auth.organizationId },
      attributes: ['id'],
    });
    scopeWhere.leave_type_id = type ? type.id : -1;
  }

  // Date-range filter uses OVERLAP semantics, not "start date within range". A request
  // matches when its [start_date, end_date] interval intersects the requested window
  // [from, to] — i.e. start_date <= to AND end_date >= from. This is what users expect
  // from "show leave in this date range" (a leave spanning the window shows even if it
  // starts before or ends after it). We apply it here and strip the raw keys so the
  // generic single-column range filter doesn't also constrain start_date on its own.
  const rangeOverlap = buildDateRangeOverlap(filters.start_date_from, filters.start_date_to);
  if (rangeOverlap) {
    Object.assign(scopeWhere, rangeOverlap);
  }
  delete filters.start_date_from;
  delete filters.start_date_to;

  const query = { ...req.query, filters };

  const result = await paginate(LeaveRequest, query, LEAVE_QUERY_CONFIG, {
    scopeWhere,
    attributes: LEAVE_ATTRIBUTES,
    include: LEAVE_INCLUDE,
  });

  // Batch-load real uploaded attachments onto the page of rows (one extra query).
  await withAttachments(result.data);
  return result;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build an interval-overlap where fragment for the leave date-range filter.
 * A leave [start_date, end_date] overlaps the window [from, to] iff
 *   start_date <= to  AND  end_date >= from.
 * Either bound may be omitted (open-ended window). Returns null when neither is a
 * valid ISO date.
 */
const buildDateRangeOverlap = (from, to) => {
  const hasFrom = typeof from === 'string' && ISO_DATE.test(from);
  const hasTo = typeof to === 'string' && ISO_DATE.test(to);
  if (!hasFrom && !hasTo) return null;

  const clause = {};
  if (hasTo) {
    // start_date <= to
    clause.start_date = { [Op.lte]: to };
  }
  if (hasFrom) {
    // end_date >= from
    clause.end_date = { [Op.gte]: from };
  }
  return clause;
};

const getLeaveByUuid = async (uuid, req, res) => {
  const leave = await findVisibleLeave(uuid, req);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
  }
  return leave;
};

/** A request is editable by its owner only while it's a draft or was rejected. */
const isOwnerEditable = (leave) =>
  leave.status === LEAVE_STATUSES.DRAFT || leave.status === LEAVE_STATUSES.REJECTED;

/**
 * Update request content. Owner-only, and only while draft/rejected. Optional
 * action:'submit' re-applies after editing (runs the paid check + hold).
 */
const updateLeave = async (uuid, body, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const leave = await LeaveRequest.findOne({
      where: { uuid, ...buildLeaveScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!leave) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
    }
    if (leave.created_by_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (!isOwnerEditable(leave)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_editable'));
    }

    if (body.leave_type !== undefined) {
      const type = await resolveLeaveType(body.leave_type, leave.organization_id, res, transaction);
      leave.leave_type_id = type.id;
    }
    if (body.start_date !== undefined) leave.start_date = formatDate(body.start_date);
    if (body.end_date !== undefined) leave.end_date = formatDate(body.end_date);
    if (body.day_portion !== undefined) leave.day_portion = body.day_portion;
    if (body.reason !== undefined) leave.reason = body.reason;
    if (body.attachments !== undefined) leave.attachments = normalizeAttachments(body.attachments);

    // Re-validate dates and recompute total after any date/portion change.
    validateDates(leave.start_date, leave.end_date, leave.day_portion, res);
    leave.total_days = computeTotalDays(leave.start_date, leave.end_date, leave.day_portion);

    if (body.action === 'submit') {
      await assertNoOverlap(
        leave.created_by_id,
        leave.organization_id,
        leave.start_date,
        leave.end_date,
        leave.id,
        res,
        transaction
      );
      const type = await LeaveType.findByPk(leave.leave_type_id, { transaction });
      leave.status = LEAVE_STATUSES.SUBMITTED;
      leave.submitted_at = new Date();
      leave.reviewed_by_id = null;
      leave.reviewed_at = null;
      leave.rejection_reason = null;
      await leave.save({ transaction });
      await holdBalanceForRequest(leave, type, req, transaction, res);
    } else {
      await leave.save({ transaction });
    }

    return findVisibleLeave(uuid, req);
  });
};

/**
 * Submit a draft/rejected request (explicit endpoint). Owner-only. Runs the paid
 * balance check + hold inside a transaction.
 */
const submitLeave = async (uuid, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const leave = await LeaveRequest.findOne({
      where: { uuid, ...buildLeaveScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!leave) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
    }
    if (leave.created_by_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (!isOwnerEditable(leave)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_submittable'));
    }

    validateDates(leave.start_date, leave.end_date, leave.day_portion, res);
    await assertNoOverlap(
      leave.created_by_id,
      leave.organization_id,
      leave.start_date,
      leave.end_date,
      leave.id,
      res,
      transaction
    );

    const type = await LeaveType.findByPk(leave.leave_type_id, { transaction });
    leave.total_days = computeTotalDays(leave.start_date, leave.end_date, leave.day_portion);
    leave.status = LEAVE_STATUSES.SUBMITTED;
    leave.submitted_at = new Date();
    leave.reviewed_by_id = null;
    leave.reviewed_at = null;
    leave.rejection_reason = null;
    await leave.save({ transaction });

    await holdBalanceForRequest(leave, type, req, transaction, res);
    return findVisibleLeave(uuid, req);
  });
};

/**
 * Hold days in the balance's `pending` bucket for a paid request. Skips entirely for
 * leave types that don't require a balance (unpaid). Enforces the available-days
 * check under a row lock. Must be called inside a transaction.
 */
const holdBalanceForRequest = async (leave, type, req, transaction, res) => {
  if (!type || !type.requires_balance) {
    return; // Unpaid / no-balance leave: nothing to check or hold.
  }
  const year = toUtcDate(leave.start_date).getUTCFullYear();
  const balance = await findOrCreateBalanceLocked(
    {
      organizationId: leave.organization_id,
      userId: leave.created_by_id,
      leaveTypeId: leave.leave_type_id,
      year,
      createdById: req.auth.userId,
    },
    transaction
  );

  const need = Number(leave.total_days);
  if (availableDays(balance) < need) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_insufficient_balance'));
  }

  balance.pending = Number(balance.pending) + need;
  await balance.save({ transaction });
  await writeLedger(
    {
      organizationId: leave.organization_id,
      balanceId: balance.id,
      requestId: leave.id,
      entryType: LEAVE_LEDGER_ENTRY_TYPES.HOLD,
      amount: need,
      balanceAfter: availableDays(balance),
      createdById: req.auth.userId,
    },
    transaction
  );
};

/**
 * Release previously-held or consumed days back to a balance (reject/withdraw/cancel).
 * `fromUsed` releases from `used` (approved -> cancelled); otherwise from `pending`.
 */
const releaseBalanceForRequest = async (leave, req, transaction, { fromUsed } = {}) => {
  const type = await LeaveType.findByPk(leave.leave_type_id, { transaction });
  if (!type || !type.requires_balance) return;

  const year = toUtcDate(leave.start_date).getUTCFullYear();
  const balance = await LeaveBalance.findOne({
    where: {
      organization_id: leave.organization_id,
      user_id: leave.created_by_id,
      leave_type_id: leave.leave_type_id,
      period_year: year,
    },
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!balance) return;

  const amount = Number(leave.total_days);
  if (fromUsed) {
    balance.used = Math.max(0, Number(balance.used) - amount);
  } else {
    balance.pending = Math.max(0, Number(balance.pending) - amount);
  }
  await balance.save({ transaction });
  await writeLedger(
    {
      organizationId: leave.organization_id,
      balanceId: balance.id,
      requestId: leave.id,
      entryType: LEAVE_LEDGER_ENTRY_TYPES.RELEASE,
      amount: -amount,
      balanceAfter: availableDays(balance),
      createdById: req.auth.userId,
    },
    transaction
  );
};

/**
 * Withdraw a still-pending request (applicant only). Releases held days.
 */
const withdrawLeave = async (uuid, req, res) => {
  return sequelize.transaction(async (transaction) => {
    const leave = await LeaveRequest.findOne({
      where: { uuid, ...buildLeaveScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!leave) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
    }
    if (leave.created_by_id !== req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (leave.status !== LEAVE_STATUSES.SUBMITTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_withdrawable'));
    }

    await releaseBalanceForRequest(leave, req, transaction, { fromUsed: false });
    leave.status = LEAVE_STATUSES.WITHDRAWN;
    await leave.save({ transaction });
    return findVisibleLeave(uuid, req);
  });
};

/**
 * Approve or reject a SUBMITTED request. Approver-only (leave.approve). On approve,
 * held pending days move to used. On reject, held days are released and the reason is
 * stored. An approver cannot decide their own request (separation of duties).
 */
const decideLeave = async (uuid, decision, rejectionReason, req, res) => {
  if (!isApprover(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  return sequelize.transaction(async (transaction) => {
    const leave = await LeaveRequest.findOne({
      where: { uuid, ...buildLeaveScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!leave) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
    }
    if (leave.created_by_id === req.auth.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('leave_self_review'));
    }
    if (leave.status !== LEAVE_STATUSES.SUBMITTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_reviewable'));
    }

    const type = await LeaveType.findByPk(leave.leave_type_id, { transaction });

    if (decision === LEAVE_DECISIONS.APPROVE) {
      // Move held pending days into used.
      if (type && type.requires_balance) {
        const year = toUtcDate(leave.start_date).getUTCFullYear();
        const balance = await LeaveBalance.findOne({
          where: {
            organization_id: leave.organization_id,
            user_id: leave.created_by_id,
            leave_type_id: leave.leave_type_id,
            period_year: year,
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (balance) {
          const amount = Number(leave.total_days);
          balance.pending = Math.max(0, Number(balance.pending) - amount);
          balance.used = Number(balance.used) + amount;
          await balance.save({ transaction });
          await writeLedger(
            {
              organizationId: leave.organization_id,
              balanceId: balance.id,
              requestId: leave.id,
              entryType: LEAVE_LEDGER_ENTRY_TYPES.CONSUME,
              amount,
              balanceAfter: availableDays(balance),
              createdById: req.auth.userId,
            },
            transaction
          );
        }
      }
      leave.status = LEAVE_STATUSES.APPROVED;
      leave.rejection_reason = null;
    } else {
      // Reject: release held pending days.
      await releaseBalanceForRequest(leave, req, transaction, { fromUsed: false });
      leave.status = LEAVE_STATUSES.REJECTED;
      leave.rejection_reason = rejectionReason;
    }

    leave.reviewed_by_id = req.auth.userId;
    leave.reviewed_at = new Date();
    await leave.save({ transaction });
    return findVisibleLeave(uuid, req);
  });
};

/**
 * Cancel a request. Approver-only. Releases held (submitted) or used (approved) days.
 * Terminal statuses (rejected/withdrawn/cancelled) can't be cancelled again.
 */
const cancelLeave = async (uuid, req, res) => {
  if (!isApprover(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  return sequelize.transaction(async (transaction) => {
    const leave = await LeaveRequest.findOne({
      where: { uuid, ...buildLeaveScope(req) },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!leave) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
    }
    if (!LEAVE_ACTIVE_STATUSES.includes(leave.status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_cancellable'));
    }

    const fromUsed = leave.status === LEAVE_STATUSES.APPROVED;
    await releaseBalanceForRequest(leave, req, transaction, { fromUsed });
    leave.status = LEAVE_STATUSES.CANCELLED;
    await leave.save({ transaction });
    return findVisibleLeave(uuid, req);
  });
};

/**
 * Delete a request. Owner may delete their own draft/rejected request; approvers may
 * delete any visible request in their org. Active (submitted/approved) requests must
 * be withdrawn/cancelled first so their held/used balance is released cleanly.
 */
const deleteLeave = async (uuid, req, res) => {
  const leave = await findVisibleLeave(uuid, req);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
  }
  const approver = isApprover(req.auth);
  const isOwner = leave.created_by_id === req.auth.userId;

  if (!approver && !isOwner) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  if (LEAVE_ACTIVE_STATUSES.includes(leave.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_deletable'));
  }
  if (!approver && !isOwnerEditable(leave)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_not_deletable'));
  }

  await leave.destroy();
  return true;
};

// ── Balances (self read) ────────────────────────────────────────────────────

/** The caller's own balances for a period year (defaults to current year). */
const getMyBalances = async (req) => {
  const year = req.query.period_year || todayUtc().getUTCFullYear();
  const balances = await LeaveBalance.findAll({
    where: {
      organization_id: req.auth.organizationId,
      user_id: req.auth.userId,
      period_year: year,
    },
    include: [{ model: LeaveType, as: 'leaveType', attributes: LEAVE_TYPE_SUMMARY_ATTRIBUTES }],
    order: [['leave_type_id', 'ASC']],
  });
  return { year, balances };
};

// ── Timesheet read contract ─────────────────────────────────────────────────

/**
 * getLeaveDays — the stable contract the future Timesheet module consumes to decide
 * whether a user is on leave on a given day (and therefore block time entry).
 *
 * Returns one entry per non-weekend leave day in [from, to] for the target user,
 * expanded from the request date ranges. Statuses default to approved only; pass
 * ['submitted','approved'] to also block on pending requests.
 *
 * Kept as a plain function (userId in, rows out) so both the HTTP controller and an
 * internal timesheet service can call it — one implementation, no duplication.
 */
const getLeaveDays = async (organizationId, userId, from, to, { statuses } = {}) => {
  const effectiveStatuses = statuses && statuses.length ? statuses : [LEAVE_STATUSES.APPROVED];
  const requests = await LeaveRequest.findAll({
    where: {
      organization_id: organizationId,
      created_by_id: userId,
      status: { [Op.in]: effectiveStatuses },
      start_date: { [Op.lte]: formatDate(to) },
      end_date: { [Op.gte]: formatDate(from) },
    },
    attributes: ['uuid', 'start_date', 'end_date', 'day_portion', 'status', 'leave_type_id'],
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['key', 'name', 'is_paid'] }],
  });

  const fromD = toUtcDate(from);
  const toD = toUtcDate(to);
  const days = [];
  for (const r of requests) {
    const spanStart = toUtcDate(r.start_date) < fromD ? fromD : toUtcDate(r.start_date);
    const spanEnd = toUtcDate(r.end_date) > toD ? toD : toUtcDate(r.end_date);
    for (const d of eachDay(spanStart, spanEnd)) {
      if (isWeekend(d)) continue;
      days.push({
        date: formatDate(d),
        leave_uuid: r.uuid,
        leave_type_key: r.leaveType ? r.leaveType.key : null,
        day_portion: r.day_portion,
        status: r.status,
      });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
};

/** HTTP wrapper for getLeaveDays with visibility rules (self, or any for approvers). */
const getCalendar = async (req, res) => {
  const { from, to } = req.query;
  let targetUserId = req.auth.userId;

  if (req.query.user) {
    if (req.query.user !== req.auth.uuid && !isApprover(req.auth)) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    const target = await User.findOne({
      where: { uuid: req.query.user, organization_id: req.auth.organizationId },
      attributes: ['id'],
    });
    if (!target) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
    }
    targetUserId = target.id;
  }

  const statuses = req.query.include_pending
    ? [LEAVE_STATUSES.SUBMITTED, LEAVE_STATUSES.APPROVED]
    : [LEAVE_STATUSES.APPROVED];

  return getLeaveDays(req.auth.organizationId, targetUserId, from, to, { statuses });
};

// ── Leave type admin ────────────────────────────────────────────────────────

const listLeaveTypes = async (req) => {
  const where = { organization_id: req.auth.organizationId };
  if (!req.query.include_inactive) where.is_active = true;
  return LeaveType.findAll({ where, order: [['name', 'ASC']] });
};

const createLeaveType = async (body, req, res) => {
  if (!isAllocator(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const organizationId = req.auth.organizationId;
  const existing = await LeaveType.findOne({
    where: { organization_id: organizationId, key: body.key },
  });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, res.__('leave_type_exists'));
  }
  return LeaveType.create({
    organization_id: organizationId,
    key: body.key,
    name: body.name,
    is_paid: body.is_paid,
    requires_balance: body.requires_balance !== undefined ? body.requires_balance : body.is_paid,
    color: body.color ?? null,
    is_active: body.is_active !== undefined ? body.is_active : true,
    created_by_id: req.auth.userId,
  });
};

const updateLeaveType = async (uuid, body, req, res) => {
  if (!isAllocator(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const type = await LeaveType.findOne({
    where: { uuid, organization_id: req.auth.organizationId },
  });
  if (!type) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_type_not_found'));
  }
  ['name', 'is_paid', 'requires_balance', 'color', 'is_active'].forEach((f) => {
    if (body[f] !== undefined) type[f] = body[f];
  });
  await type.save();
  return type;
};

// ── Balance admin ───────────────────────────────────────────────────────────

const listBalances = async (req) => {
  const scopeWhere = { organization_id: req.auth.organizationId };
  if (req.query.user) {
    const target = await User.findOne({
      where: { uuid: req.query.user, organization_id: req.auth.organizationId },
      attributes: ['id'],
    });
    scopeWhere.user_id = target ? target.id : -1;
  }
  return paginate(LeaveBalance, req.query, LEAVE_BALANCE_QUERY_CONFIG, {
    scopeWhere,
    include: [
      { model: LeaveType, as: 'leaveType', attributes: LEAVE_TYPE_SUMMARY_ATTRIBUTES },
      { model: User, as: 'user', attributes: USER_SUMMARY_ATTRIBUTES },
    ],
  });
};

/**
 * Allocate/set a user's balance for a type + year (admin, leave.allocate). Sets the
 * `allocated` value (absolute), preserving used/pending. Writes an allocation ledger
 * entry for the delta. Runs in a transaction with a row lock.
 */
const allocateBalance = async (body, req, res) => {
  if (!isAllocator(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  return sequelize.transaction(async (transaction) => {
    // Resolve the target user. A super_admin has no single org (organizationId is null)
    // and may allocate to a user in ANY organization, so their lookup is unrestricted;
    // everyone else is confined to their own org. The organization the balance belongs
    // to is then DERIVED from the resolved user (never the caller's token), so the
    // ledger/type all line up with the user's actual tenant.
    const userWhere = { uuid: body.user };
    if (!req.auth.isSuperAdmin) {
      userWhere.organization_id = req.auth.organizationId;
    }
    const user = await User.findOne({
      where: userWhere,
      attributes: ['id', 'organization_id'],
      transaction,
    });
    if (!user || !user.organization_id) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('user_not_found'));
    }
    const organizationId = user.organization_id;
    const type = await resolveLeaveType(body.leave_type, organizationId, res, transaction);

    const balance = await findOrCreateBalanceLocked(
      {
        organizationId,
        userId: user.id,
        leaveTypeId: type.id,
        year: body.period_year,
        createdById: req.auth.userId,
      },
      transaction
    );

    const previous = Number(balance.allocated);
    const next = Number(body.allocated);
    // Can't set allocated below what's already used + pending.
    if (next < Number(balance.used) + Number(balance.pending)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_allocation_too_low'));
    }
    balance.allocated = next;
    balance.created_by_id = req.auth.userId;
    await balance.save({ transaction });

    await writeLedger(
      {
        organizationId,
        balanceId: balance.id,
        requestId: null,
        entryType: LEAVE_LEDGER_ENTRY_TYPES.ALLOCATION,
        amount: next - previous,
        balanceAfter: availableDays(balance),
        createdById: req.auth.userId,
      },
      transaction
    );

    return balance;
  });
};

/**
 * Allocate a set of leave balances for a user, INSIDE a caller-supplied transaction.
 *
 * This is the transaction-friendly sibling of `allocateBalance` (which is HTTP/RBAC
 * oriented and opens its own transaction). It's meant to be composed into a larger
 * unit of work — e.g. seeding a new user's time-off during user creation — so the
 * whole thing commits or rolls back atomically. The caller is responsible for the
 * RBAC check (the user.create flow already gates on the creator's permissions).
 *
 * `allocations` is [{ leaveTypeUuid, allocated }]. Each entry sets the ABSOLUTE
 * `allocated` value for (org, user, type, year), preserving used/pending, and writes
 * an ALLOCATION ledger entry for the delta. Entries with allocated <= 0 are skipped
 * (nothing to grant). Leave types are resolved within `organizationId`, so a type
 * from another org is rejected. Duplicate leave types in the input are ignored after
 * the first (the unique per-type row makes repeats meaningless).
 *
 * Returns the array of created/updated LeaveBalance rows.
 */
const allocateBalancesForUser = async (
  { organizationId, userId, createdById, year, allocations },
  transaction,
  res
) => {
  if (!Array.isArray(allocations) || allocations.length === 0) return [];

  const periodYear = year || new Date().getUTCFullYear();
  const results = [];
  const seenTypeIds = new Set();

  for (const entry of allocations) {
    const amount = Number(entry.allocated);
    // Skip empty/zero grants — creating a 0-allocated row adds no value.
    if (!Number.isFinite(amount) || amount <= 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const type = await resolveLeaveType(entry.leave_type, organizationId, res, transaction);
    if (seenTypeIds.has(type.id)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    seenTypeIds.add(type.id);

    // eslint-disable-next-line no-await-in-loop
    const balance = await findOrCreateBalanceLocked(
      { organizationId, userId, leaveTypeId: type.id, year: periodYear, createdById },
      transaction
    );

    const previous = Number(balance.allocated);
    // Absolute set, guarded against dropping below used + pending (won't happen for a
    // brand-new user, but keeps the invariant identical to allocateBalance).
    if (amount < Number(balance.used) + Number(balance.pending)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('leave_allocation_too_low'));
    }
    balance.allocated = amount;
    balance.created_by_id = createdById;
    // eslint-disable-next-line no-await-in-loop
    await balance.save({ transaction });

    // eslint-disable-next-line no-await-in-loop
    await writeLedger(
      {
        organizationId,
        balanceId: balance.id,
        requestId: null,
        entryType: LEAVE_LEDGER_ENTRY_TYPES.ALLOCATION,
        amount: amount - previous,
        balanceAfter: availableDays(balance),
        createdById,
      },
      transaction
    );

    results.push(balance);
  }

  return results;
};

/**
 * Ensure the default leave types exist for an organization. Idempotent — safe to call
 * on org creation or from the seeder. Not tenant-scoped by the middleware (system op).
 */
const ensureDefaultLeaveTypes = async (organizationId, createdById = null, transaction) => {
  for (const def of DEFAULT_LEAVE_TYPES) {
    // eslint-disable-next-line no-await-in-loop
    await LeaveType.findOrCreate({
      where: { organization_id: organizationId, key: def.key },
      defaults: {
        organization_id: organizationId,
        key: def.key,
        name: def.name,
        is_paid: def.is_paid,
        requires_balance: def.requires_balance,
        color: def.color,
        is_active: true,
        created_by_id: createdById,
      },
      transaction,
    });
  }
};

// ── Attachments (real files, backed by the polymorphic attachments table) ────────
//
// These sit on top of the generic attachment.service and mirror the expense feature.
// The leave is always resolved WITHIN the caller's visibility scope first, so owner_id
// is derived server-side and never trusted from the client. Uploading/deleting is an
// owner action on an editable (draft/rejected) request; listing follows read visibility.

/** True when the caller may add/remove files on this leave (owner + draft/rejected). */
const canModifyAttachments = (leave, auth) =>
  leave.created_by_id === auth.userId && isOwnerEditable(leave);

/**
 * Upload one or more files to a leave request (multipart already parsed onto req).
 * Owner-only, and only while the request is a draft or rejected.
 */
const uploadLeaveAttachments = async (uuid, req, res) => {
  const leave = await findVisibleLeave(uuid, req);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
  }
  if (!canModifyAttachments(leave, req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  return attachmentService.uploadAndPersist(req, {
    ownerType: LEAVE_OWNER_TYPE,
    ownerId: leave.id,
    organizationId: leave.organization_id,
    uploadedById: req.auth.userId,
    folder: UPLOAD_FOLDERS.LEAVES,
  });
};

/** List a leave request's uploaded files. Follows read visibility. */
const listLeaveAttachments = async (uuid, req, res) => {
  const leave = await findVisibleLeave(uuid, req);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
  }
  return attachmentService.listForOwner(LEAVE_OWNER_TYPE, leave.id, req.tenantWhere);
};

/**
 * Delete one uploaded file from a leave request. Owner-only + draft/rejected, and the
 * attachment must actually belong to that request (guards against cross-request uuids).
 */
const deleteLeaveAttachment = async (uuid, attachmentUuid, req, res) => {
  const leave = await findVisibleLeave(uuid, req);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('leave_not_found'));
  }
  if (!canModifyAttachments(leave, req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  const row = await Attachment.findOne({
    where: {
      uuid: attachmentUuid,
      owner_type: LEAVE_OWNER_TYPE,
      owner_id: leave.id,
      ...req.tenantWhere,
    },
  });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('file_not_found'));
  }
  await attachmentService.deleteByUuid(attachmentUuid, req.tenantWhere);
  return true;
};

module.exports = {
  createLeave,
  listLeaves,
  getLeaveByUuid,
  updateLeave,
  submitLeave,
  withdrawLeave,
  decideLeave,
  cancelLeave,
  deleteLeave,
  uploadLeaveAttachments,
  listLeaveAttachments,
  deleteLeaveAttachment,
  LEAVE_OWNER_TYPE,
  getMyBalances,
  getLeaveDays,
  getCalendar,
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  listBalances,
  allocateBalance,
  allocateBalancesForUser,
  ensureDefaultLeaveTypes,
  buildLeaveScope,
  isApprover,
  isAllocator,
};
