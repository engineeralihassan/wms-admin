const httpStatus = require('http-status');
const {
  Deal,
  DealEvent,
  Account,
  Contact,
  SalesPipeline,
  SalesConfig,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { DEAL_QUERY_CONFIG } = require('../../config/query-configs');
const {
  DEAL_EVENT_TYPES,
  DEAL_STATUSES,
  DEAL_CODE_PREFIX,
  DEFAULT_CURRENCY,
} = require('../../utils/sales.constants');
const {
  buildDealScope,
  buildAccountScope,
  buildContactScope,
  nextSequenceCode,
  validateCustomFields,
  getStageOrThrow,
  statusFromStage,
} = require('./sales.shared');
const { ensureSalesConfig } = require('./sales-config.service');

/**
 * deal.service — business logic for deals/opportunities (the money-bearing, audited core).
 *
 * Visibility follows the sales owner overlay (buildDealScope): a sales_rep sees only their
 * own deals; a sales_manager / org_admin (deal.manage_all) sees the whole org. Multi-
 * currency per deal. Every stage move / owner change / creation writes an immutable
 * DealEvent — the same audit pattern as the ATS ApplicationEvent.
 */

const DEAL_ATTRIBUTES = [
  'id',
  'uuid',
  'deal_number',
  'organization_id',
  'owner_id',
  'created_by_id',
  'pipeline_id',
  'stage_key',
  'account_id',
  'contact_id',
  'source_lead_id',
  'title',
  'amount',
  'currency',
  'probability',
  'expected_close_date',
  'closed_at',
  'status',
  'custom_fields',
  'createdAt',
  'updatedAt',
];

const DEAL_INCLUDE = [
  { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: Account, as: 'account', attributes: ['uuid', 'account_number', 'name'] },
  { model: Contact, as: 'contact', attributes: ['uuid', 'first_name', 'last_name'] },
  { model: SalesPipeline, as: 'pipeline', attributes: ['uuid', 'name', 'stages'] },
];

const getConfig = async (organizationId, transaction) => {
  const existing = await SalesConfig.findOne({ where: { organization_id: organizationId }, transaction });
  if (existing) return existing;
  return ensureSalesConfig(organizationId, null, transaction);
};

const resolveOrgUserId = async (userUuid, req, res, transaction) => {
  const user = await User.findOne({
    where: { uuid: userUuid, ...req.tenantWhere },
    attributes: ['id'],
    transaction,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_owner_not_found'));
  }
  return user.id;
};

/** Resolve a pipeline by uuid within the tenant, or the org's default when omitted. */
const resolvePipeline = async (pipelineUuid, organizationId, res, transaction) => {
  const where = pipelineUuid
    ? { uuid: pipelineUuid, organization_id: organizationId }
    : { organization_id: organizationId, is_default: true };
  const pipeline = await SalesPipeline.findOne({ where, transaction });
  if (!pipeline) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_pipeline_not_found'));
  }
  return pipeline;
};

const resolveAccountId = async (accountUuid, req, res, transaction) => {
  if (!accountUuid) return null;
  const account = await Account.findOne({
    where: { uuid: accountUuid, ...buildAccountScope(req) },
    attributes: ['id'],
    transaction,
  });
  if (!account) throw new ApiError(httpStatus.NOT_FOUND, res.__('account_not_found'));
  return account.id;
};

const resolveContactId = async (contactUuid, req, res, transaction) => {
  if (!contactUuid) return null;
  const contact = await Contact.findOne({
    where: { uuid: contactUuid, ...buildContactScope(req) },
    attributes: ['id'],
    transaction,
  });
  if (!contact) throw new ApiError(httpStatus.NOT_FOUND, res.__('contact_not_found'));
  return contact.id;
};

/** List deals (tenant + owner scoped). */
const listDeals = async (req) =>
  paginate(Deal, req.query, DEAL_QUERY_CONFIG, {
    scopeWhere: buildDealScope(req),
    attributes: DEAL_ATTRIBUTES,
    include: DEAL_INCLUDE,
  });

/** Fetch a deal the caller may see, or throw 404. */
const findVisibleDeal = async (uuid, req, res, transaction) => {
  const deal = await Deal.findOne({
    where: { uuid, ...buildDealScope(req) },
    attributes: DEAL_ATTRIBUTES,
    include: DEAL_INCLUDE,
    transaction,
  });
  if (!deal) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('deal_not_found'));
  }
  return deal;
};

/** Read one deal with its event history. */
const getDealByUuid = async (uuid, req, res) => {
  const deal = await findVisibleDeal(uuid, req, res);
  const events = await DealEvent.findAll({
    where: { deal_id: deal.id },
    include: [{ model: User, as: 'actor', attributes: ['uuid', 'first_name', 'last_name'] }],
    order: [['created_at', 'ASC']],
  });
  return { deal, events };
};

/**
 * Kanban board: deals for a pipeline grouped by stage. Returns the pipeline's stages in
 * order, each with its deals (scoped to the caller). Powers the drag-and-drop board.
 */
const getBoard = async (req, res) => {
  const organizationId = req.auth.organizationId;
  const pipeline = await resolvePipeline(req.query.pipeline, organizationId, res);
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];

  const deals = await Deal.findAll({
    where: { ...buildDealScope(req), pipeline_id: pipeline.id },
    attributes: DEAL_ATTRIBUTES,
    include: DEAL_INCLUDE,
    order: [['updated_at', 'DESC']],
  });

  const byStage = new Map(stages.map((s) => [s.key, []]));
  for (const d of deals) {
    if (byStage.has(d.stage_key)) byStage.get(d.stage_key).push(d);
    else byStage.set(d.stage_key, [d]); // orphaned stage_key (pipeline edited) still shown
  }

  const columns = stages.map((s) => ({
    stage: s,
    deals: byStage.get(s.key) || [],
  }));
  return { pipeline, columns };
};

/**
 * Create a deal. Resolves pipeline (default if omitted) + validates the stage; seeds
 * probability + status from the stage. account/contact links optional (B2B/B2C).
 */
const createDeal = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const deal = await sequelize.transaction(async (transaction) => {
    const config = await getConfig(organizationId, transaction);
    const custom = validateCustomFields(body.custom_fields, config.custom_fields?.deal);

    const pipeline = await resolvePipeline(body.pipeline_uuid, organizationId, res, transaction);
    const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
    const stageKey = body.stage_key || (stages[0] && stages[0].key);
    const stage = getStageOrThrow(pipeline, stageKey);

    let ownerId = req.auth.userId;
    if (body.owner_uuid) {
      ownerId = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }
    const accountId = await resolveAccountId(body.account_uuid, req, res, transaction);
    const contactId = await resolveContactId(body.contact_uuid, req, res, transaction);

    const deal_number = await nextSequenceCode(Deal, DEAL_CODE_PREFIX, transaction);
    const created = await Deal.create(
      {
        deal_number,
        organization_id: organizationId,
        owner_id: ownerId,
        created_by_id: req.auth.userId,
        pipeline_id: pipeline.id,
        stage_key: stage.key,
        account_id: accountId,
        contact_id: contactId,
        title: body.title,
        amount: body.amount ?? 0,
        currency: body.currency || config.defaults?.currency || DEFAULT_CURRENCY,
        probability: body.probability ?? stage.probability ?? 0,
        expected_close_date: body.expected_close_date || null,
        status: statusFromStage(stage),
        closed_at: stage.is_won || stage.is_lost ? new Date() : null,
        custom_fields: custom,
      },
      { transaction }
    );

    await DealEvent.create(
      {
        organization_id: organizationId,
        deal_id: created.id,
        created_by_id: req.auth.userId,
        entry_type: DEAL_EVENT_TYPES.CREATED,
        from_value: null,
        to_value: stage.key,
        note: null,
      },
      { transaction }
    );

    return created;
  });

  return getDealByUuid(deal.uuid, req, res);
};

/** Update a deal's scalar fields + links (not the stage — that's the stage endpoint). */
const updateDeal = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const deal = await Deal.findOne({
      where: { uuid, ...buildDealScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deal) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('deal_not_found'));
    }

    const previousAmount = deal.amount;

    if (body.title !== undefined) deal.title = body.title;
    if (body.amount !== undefined) deal.amount = body.amount;
    if (body.currency !== undefined) deal.currency = body.currency;
    if (body.probability !== undefined) deal.probability = body.probability;
    if (body.expected_close_date !== undefined) deal.expected_close_date = body.expected_close_date;
    if (body.account_uuid !== undefined) {
      deal.account_id = await resolveAccountId(body.account_uuid, req, res, transaction);
    }
    if (body.contact_uuid !== undefined) {
      deal.contact_id = await resolveContactId(body.contact_uuid, req, res, transaction);
    }
    if (body.custom_fields !== undefined) {
      const config = await getConfig(deal.organization_id, transaction);
      deal.custom_fields = validateCustomFields(body.custom_fields, config.custom_fields?.deal);
    }
    await deal.save({ transaction });

    if (body.amount !== undefined && String(body.amount) !== String(previousAmount)) {
      await DealEvent.create(
        {
          organization_id: deal.organization_id,
          deal_id: deal.id,
          created_by_id: req.auth.userId,
          entry_type: DEAL_EVENT_TYPES.AMOUNT_CHANGED,
          from_value: previousAmount != null ? String(previousAmount) : null,
          to_value: String(body.amount),
          note: null,
        },
        { transaction }
      );
    }
  });

  return getDealByUuid(uuid, req, res);
};

/**
 * Move a deal to another stage of its pipeline (the Kanban drag action). Recomputes
 * probability (from the stage unless overridden) and status (open/won/lost), sets
 * closed_at on terminal stages, and appends a STAGE_CHANGED event (+ WON/LOST on terminal).
 * Row-locked so concurrent moves can't race.
 */
const changeStage = async (uuid, body, req, res) => {
  const { stage_key: nextStageKey, note } = body;

  await sequelize.transaction(async (transaction) => {
    // Row-lock the deal WITHOUT a join: Postgres forbids FOR UPDATE on the nullable side
    // of an outer join, so the included pipeline is loaded separately (unlocked) below.
    const deal = await Deal.findOne({
      where: { uuid, ...buildDealScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deal) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('deal_not_found'));
    }

    // Load the deal's pipeline (its stages) to validate the target stage. Read-only, so
    // it doesn't need the row lock; scoped to the same org for safety.
    const pipeline = await SalesPipeline.findOne({
      where: { id: deal.pipeline_id, organization_id: deal.organization_id },
      attributes: ['id', 'stages'],
      transaction,
    });
    if (!pipeline) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_pipeline_not_found'));
    }

    const stage = getStageOrThrow(pipeline, nextStageKey);
    const previousStage = deal.stage_key;
    if (previousStage === stage.key) {
      return; // no-op move
    }

    deal.stage_key = stage.key;
    if (body.probability !== undefined) {
      deal.probability = body.probability;
    } else {
      deal.probability = stage.probability ?? deal.probability;
    }
    const nextStatus = statusFromStage(stage);
    deal.status = nextStatus;
    deal.closed_at = nextStatus === DEAL_STATUSES.OPEN ? null : new Date();
    await deal.save({ transaction });

    await DealEvent.create(
      {
        organization_id: deal.organization_id,
        deal_id: deal.id,
        created_by_id: req.auth.userId,
        entry_type: DEAL_EVENT_TYPES.STAGE_CHANGED,
        from_value: previousStage,
        to_value: stage.key,
        note: note || null,
      },
      { transaction }
    );

    // Also log the terminal outcome so "won/lost" is a first-class event for reporting.
    if (nextStatus === DEAL_STATUSES.WON || nextStatus === DEAL_STATUSES.LOST) {
      await DealEvent.create(
        {
          organization_id: deal.organization_id,
          deal_id: deal.id,
          created_by_id: req.auth.userId,
          entry_type: nextStatus === DEAL_STATUSES.WON ? DEAL_EVENT_TYPES.WON : DEAL_EVENT_TYPES.LOST,
          from_value: previousStage,
          to_value: stage.key,
          note: null,
        },
        { transaction }
      );
    }
  });

  return getDealByUuid(uuid, req, res);
};

/** Reassign a deal's owner (requires deal.reassign). Writes an OWNER_CHANGED event. */
const reassignDeal = async (uuid, ownerUuid, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const deal = await Deal.findOne({
      where: { uuid, ...buildDealScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deal) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('deal_not_found'));
    }
    const newOwnerId = await resolveOrgUserId(ownerUuid, req, res, transaction);
    const previousOwner = deal.owner_id;
    deal.owner_id = newOwnerId;
    await deal.save({ transaction });

    await DealEvent.create(
      {
        organization_id: deal.organization_id,
        deal_id: deal.id,
        created_by_id: req.auth.userId,
        entry_type: DEAL_EVENT_TYPES.OWNER_CHANGED,
        from_value: previousOwner != null ? String(previousOwner) : null,
        to_value: String(newOwnerId),
        note: null,
      },
      { transaction }
    );
  });

  return getDealByUuid(uuid, req, res);
};

/** Delete a deal and its events. */
const deleteDeal = async (uuid, req, res) => {
  const deal = await findVisibleDeal(uuid, req, res);
  await sequelize.transaction(async (transaction) => {
    await DealEvent.destroy({ where: { deal_id: deal.id }, transaction });
    await Deal.destroy({ where: { id: deal.id }, transaction });
  });
};

module.exports = {
  DEAL_ATTRIBUTES,
  listDeals,
  findVisibleDeal,
  getDealByUuid,
  getBoard,
  createDeal,
  updateDeal,
  changeStage,
  reassignDeal,
  deleteDeal,
};
