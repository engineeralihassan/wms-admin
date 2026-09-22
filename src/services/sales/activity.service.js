const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  SalesActivity,
  Lead,
  Account,
  Contact,
  Deal,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { SALES_ACTIVITY_QUERY_CONFIG } = require('../../config/query-configs');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_TASK_TYPES,
  RELATED_TYPES,
} = require('../../utils/sales.constants');
const {
  buildSalesWideScope,
  buildLeadScope,
  buildAccountScope,
  buildContactScope,
  buildDealScope,
} = require('./sales.shared');

/**
 * activity.service — logged interactions and tasks (calls/meetings/emails/notes/tasks/
 * follow-ups), attached polymorphically to a lead/account/contact/deal.
 *
 * Visibility: an activity is visible if the caller owns it OR is a sales manager
 * (buildSalesWideScope). Additionally, to LOG an activity against a record, the caller
 * must be able to SEE that parent record — enforced by resolving the parent under its own
 * scope. Task-type activities (task/follow_up) carry due_at + an open/completed lifecycle;
 * log types default to completed.
 */

const ACTIVITY_ATTRIBUTES = [
  'id',
  'uuid',
  'organization_id',
  'owner_id',
  'created_by_id',
  'related_type',
  'related_id',
  'activity_type',
  'subject',
  'body',
  'due_at',
  'completed_at',
  'status',
  'createdAt',
  'updatedAt',
];

const ACTIVITY_INCLUDE = [
  { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
];

/**
 * Resolve the polymorphic parent (lead/account/contact/deal) by its public uuid, UNDER
 * the caller's scope for that type. Returns { id, type }. Throws 404 if the caller can't
 * see it — so a rep can't log activities against another rep's record.
 */
const resolveParent = async (relatedType, relatedUuid, req, res, transaction) => {
  const map = {
    [RELATED_TYPES.LEAD]: { model: Lead, scope: buildLeadScope, notFound: 'lead_not_found' },
    [RELATED_TYPES.ACCOUNT]: { model: Account, scope: buildAccountScope, notFound: 'account_not_found' },
    [RELATED_TYPES.CONTACT]: { model: Contact, scope: buildContactScope, notFound: 'contact_not_found' },
    [RELATED_TYPES.DEAL]: { model: Deal, scope: buildDealScope, notFound: 'deal_not_found' },
  };
  const entry = map[relatedType];
  if (!entry) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('activity_invalid_related'));
  }
  const record = await entry.model.findOne({
    where: { uuid: relatedUuid, ...entry.scope(req) },
    attributes: ['id'],
    transaction,
  });
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__(entry.notFound));
  }
  return { id: record.id, type: relatedType };
};

/**
 * List activities for a specific related record (its timeline). The parent is resolved
 * under scope first, so visibility is inherited from the record.
 */
const listForRecord = async (relatedType, relatedUuid, req, res) => {
  const parent = await resolveParent(relatedType, relatedUuid, req, res);
  return paginate(SalesActivity, req.query, SALES_ACTIVITY_QUERY_CONFIG, {
    scopeWhere: { ...req.tenantWhere, related_type: parent.type, related_id: parent.id },
    attributes: ACTIVITY_ATTRIBUTES,
    include: ACTIVITY_INCLUDE,
  });
};

/** My open/overdue tasks & follow-ups (owner-scoped, soonest due first). */
const listMyTasks = async (req) => {
  const overdueOnly = req.query.overdue === 'true' || req.query.overdue === true;
  const where = {
    ...req.tenantWhere,
    owner_id: req.auth.userId,
    activity_type: { [Op.in]: ACTIVITY_TASK_TYPES },
    status: ACTIVITY_STATUSES.OPEN,
  };
  if (overdueOnly) {
    where.due_at = { [Op.lt]: new Date() };
  }
  return paginate(
    SalesActivity,
    { ...req.query, sortBy: 'due_at', sortDir: req.query.sortDir || 'asc' },
    SALES_ACTIVITY_QUERY_CONFIG,
    { scopeWhere: where, attributes: ACTIVITY_ATTRIBUTES, include: ACTIVITY_INCLUDE }
  );
};

/** Fetch an activity the caller may see (owner or manager), or throw 404. */
const findVisibleActivity = async (uuid, req, res, transaction) => {
  const activity = await SalesActivity.findOne({
    where: { uuid, ...buildSalesWideScope(req) },
    attributes: ACTIVITY_ATTRIBUTES,
    include: ACTIVITY_INCLUDE,
    transaction,
  });
  if (!activity) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('activity_not_found'));
  }
  return activity;
};

const getActivityByUuid = async (uuid, req, res) => {
  const activity = await findVisibleActivity(uuid, req, res);
  return { activity };
};

/**
 * Log an activity against a parent record. Task/follow_up types are created OPEN and may
 * carry a due date; other types (call/meeting/email/note) are historical logs and default
 * to COMPLETED now. owner defaults to the creator.
 */
const createActivity = async (body, req, res) => {
  const organizationId = req.auth.organizationId;
  const isTask = ACTIVITY_TASK_TYPES.includes(body.activity_type);

  const activity = await sequelize.transaction(async (transaction) => {
    const parent = await resolveParent(body.related_type, body.related_uuid, req, res, transaction);
    return SalesActivity.create(
      {
        organization_id: organizationId,
        owner_id: req.auth.userId,
        created_by_id: req.auth.userId,
        related_type: parent.type,
        related_id: parent.id,
        activity_type: body.activity_type,
        subject: body.subject,
        body: body.body || null,
        due_at: isTask ? body.due_at || null : null,
        status: isTask ? ACTIVITY_STATUSES.OPEN : ACTIVITY_STATUSES.COMPLETED,
        completed_at: isTask ? null : new Date(),
      },
      { transaction }
    );
  });

  return getActivityByUuid(activity.uuid, req, res);
};

/** Update an activity's editable fields (subject/body/due_at). */
const updateActivity = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const activity = await SalesActivity.findOne({
      where: { uuid, ...buildSalesWideScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!activity) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('activity_not_found'));
    }
    if (body.subject !== undefined) activity.subject = body.subject;
    if (body.body !== undefined) activity.body = body.body;
    if (body.due_at !== undefined) activity.due_at = body.due_at;
    await activity.save({ transaction });
  });
  return getActivityByUuid(uuid, req, res);
};

/** Mark a task-type activity complete (or reopen). */
const setActivityStatus = async (uuid, status, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const activity = await SalesActivity.findOne({
      where: { uuid, ...buildSalesWideScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!activity) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('activity_not_found'));
    }
    activity.status = status;
    activity.completed_at = status === ACTIVITY_STATUSES.COMPLETED ? new Date() : null;
    await activity.save({ transaction });
  });
  return getActivityByUuid(uuid, req, res);
};

/** Delete an activity. */
const deleteActivity = async (uuid, req, res) => {
  const activity = await findVisibleActivity(uuid, req, res);
  await SalesActivity.destroy({ where: { id: activity.id } });
};

module.exports = {
  ACTIVITY_ATTRIBUTES,
  listForRecord,
  listMyTasks,
  findVisibleActivity,
  getActivityByUuid,
  createActivity,
  updateActivity,
  setActivityStatus,
  deleteActivity,
};
