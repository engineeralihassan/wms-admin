const httpStatus = require('http-status');
const {
  Lead,
  LeadEvent,
  DealEvent,
  Account,
  Contact,
  Deal,
  SalesPipeline,
  SalesConfig,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { LEAD_QUERY_CONFIG } = require('../../config/query-configs');
const {
  LEAD_STATUSES,
  LEAD_EVENT_TYPES,
  DEAL_EVENT_TYPES,
  DEAL_STATUSES,
  LEAD_CODE_PREFIX,
  ACCOUNT_CODE_PREFIX,
  DEAL_CODE_PREFIX,
  DEFAULT_CURRENCY,
} = require('../../utils/sales.constants');
const {
  buildLeadScope,
  buildAccountScope,
  nextSequenceCode,
  validateCustomFields,
  assertValidLeadSource,
  getStageOrThrow,
  statusFromStage,
} = require('./sales.shared');
const { ensureSalesConfig } = require('./sales-config.service');

/**
 * lead.service — business logic for sales leads (the top of the funnel).
 *
 * Visibility follows the sales owner overlay (sales.shared.buildLeadScope): a sales_rep
 * sees/acts on only their OWN leads (owner_id = self); a sales_manager / org_admin
 * (lead.manage_all) sees the whole org; super_admin spans orgs. organization_id and
 * owner defaults are always derived server-side, never trusted from the body.
 *
 * Every meaningful change appends an immutable LeadEvent (mirrors ApplicationEvent).
 * Conversion turns a lead into an Account + Contact (+ optional Deal) in one transaction.
 */

const LEAD_ATTRIBUTES = [
  'id',
  'uuid',
  'lead_number',
  'organization_id',
  'owner_id',
  'created_by_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'company_name',
  'industry',
  'website',
  'source',
  'status',
  'estimated_value',
  'currency',
  'custom_fields',
  'converted_account_id',
  'converted_contact_id',
  'converted_deal_id',
  'converted_at',
  'ai_score',
  'ai_band',
  'ai_breakdown',
  'ai_scored_at',
  'createdAt',
  'updatedAt',
];

const LEAD_INCLUDE = [
  { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
];

/** Load the org's SalesConfig (for source + custom-field validation), creating it lazily. */
const getConfig = async (organizationId, transaction) => {
  const existing = await SalesConfig.findOne({ where: { organization_id: organizationId }, transaction });
  if (existing) return existing;
  return ensureSalesConfig(organizationId, null, transaction);
};

/**
 * Resolve a user by public uuid WITHIN the caller's tenant. Used when (re)assigning a
 * lead owner — the target must be a user in the same organization. Returns the user id.
 */
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

/** List leads (tenant + owner scoped). */
const listLeads = async (req) =>
  paginate(Lead, req.query, LEAD_QUERY_CONFIG, {
    scopeWhere: buildLeadScope(req),
    attributes: LEAD_ATTRIBUTES,
    include: LEAD_INCLUDE,
  });

/** Fetch a lead the caller may see (tenant + owner scoped), or throw 404. */
const findVisibleLead = async (uuid, req, res, transaction) => {
  const lead = await Lead.findOne({
    where: { uuid, ...buildLeadScope(req) },
    attributes: LEAD_ATTRIBUTES,
    include: LEAD_INCLUDE,
    transaction,
  });
  if (!lead) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('lead_not_found'));
  }
  return lead;
};

/** Read one lead with its event history. */
const getLeadByUuid = async (uuid, req, res) => {
  const lead = await findVisibleLead(uuid, req, res);
  const events = await LeadEvent.findAll({
    where: { lead_id: lead.id },
    include: [{ model: User, as: 'actor', attributes: ['uuid', 'first_name', 'last_name'] }],
    order: [['created_at', 'ASC']],
  });
  return { lead, events };
};

/**
 * Create a lead. owner defaults to the creator (a rep owns what they create); a manager
 * may pass an explicit owner_uuid (resolved within the tenant). custom_fields + source
 * are validated against the org's SalesConfig.
 */
const createLead = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const lead = await sequelize.transaction(async (transaction) => {
    const config = await getConfig(organizationId, transaction);
    assertValidLeadSource(body.source, config);
    const custom = validateCustomFields(body.custom_fields, config.custom_fields?.lead);

    // Owner: explicit (manager) resolved within tenant, else the creator.
    let ownerId = req.auth.userId;
    if (body.owner_uuid) {
      ownerId = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }

    const lead_number = await nextSequenceCode(Lead, LEAD_CODE_PREFIX, transaction);
    const created = await Lead.create(
      {
        lead_number,
        organization_id: organizationId,
        owner_id: ownerId,
        created_by_id: req.auth.userId,
        first_name: body.first_name,
        last_name: body.last_name || null,
        email: body.email || null,
        phone: body.phone || null,
        job_title: body.job_title || null,
        company_name: body.company_name || null,
        industry: body.industry || null,
        website: body.website || null,
        source: body.source || null,
        status: LEAD_STATUSES.NEW,
        estimated_value: body.estimated_value ?? null,
        currency: body.currency || null,
        custom_fields: custom,
      },
      { transaction }
    );

    await LeadEvent.create(
      {
        organization_id: organizationId,
        lead_id: created.id,
        created_by_id: req.auth.userId,
        entry_type: LEAD_EVENT_TYPES.CREATED,
        from_value: null,
        to_value: LEAD_STATUSES.NEW,
        note: null,
      },
      { transaction }
    );

    return created;
  });

  return getLeadByUuid(lead.uuid, req, res);
};

/**
 * Update a lead's fields. A converted lead is immutable (its record is now the
 * account/contact/deal). Status changes and custom fields are validated; a status change
 * writes a STATUS_CHANGED event.
 */
const updateLead = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const lead = await Lead.findOne({
      where: { uuid, ...buildLeadScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lead) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('lead_not_found'));
    }
    if (lead.status === LEAD_STATUSES.CONVERTED) {
      throw new ApiError(httpStatus.CONFLICT, res.__('lead_already_converted'));
    }

    const config = await getConfig(lead.organization_id, transaction);
    if (body.source !== undefined) assertValidLeadSource(body.source, config);

    const previousStatus = lead.status;

    const scalarFields = [
      'first_name', 'last_name', 'email', 'phone', 'job_title',
      'company_name', 'industry', 'website', 'source', 'estimated_value', 'currency',
    ];
    for (const f of scalarFields) {
      if (body[f] !== undefined) lead[f] = body[f];
    }
    if (body.status !== undefined) lead.status = body.status;
    if (body.custom_fields !== undefined) {
      lead.custom_fields = validateCustomFields(body.custom_fields, config.custom_fields?.lead);
    }
    await lead.save({ transaction });

    if (body.status !== undefined && body.status !== previousStatus) {
      await LeadEvent.create(
        {
          organization_id: lead.organization_id,
          lead_id: lead.id,
          created_by_id: req.auth.userId,
          entry_type: LEAD_EVENT_TYPES.STATUS_CHANGED,
          from_value: previousStatus,
          to_value: body.status,
          note: null,
        },
        { transaction }
      );
    }
  });

  return getLeadByUuid(uuid, req, res);
};

/**
 * Reassign a lead's owner (requires lead.assign — a manager capability). Resolves the
 * new owner within the tenant and writes an OWNER_CHANGED event.
 */
const assignLead = async (uuid, ownerUuid, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const lead = await Lead.findOne({
      where: { uuid, ...buildLeadScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lead) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('lead_not_found'));
    }
    const newOwnerId = await resolveOrgUserId(ownerUuid, req, res, transaction);
    const previousOwner = lead.owner_id;
    lead.owner_id = newOwnerId;
    await lead.save({ transaction });

    await LeadEvent.create(
      {
        organization_id: lead.organization_id,
        lead_id: lead.id,
        created_by_id: req.auth.userId,
        entry_type: LEAD_EVENT_TYPES.OWNER_CHANGED,
        from_value: previousOwner != null ? String(previousOwner) : null,
        to_value: String(newOwnerId),
        note: null,
      },
      { transaction }
    );
  });

  return getLeadByUuid(uuid, req, res);
};

/**
 * Convert a lead into an Account (B2B, from company fields or an existing account) +
 * Contact (+ optional Deal), all in one transaction. Idempotent: converting an
 * already-converted lead returns its existing linked records.
 *
 * @param {object} body { account_uuid?, create_deal?, deal: { title, amount, currency,
 *                         pipeline_uuid?, stage_key?, expected_close_date? } }
 */
const convertLead = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const lead = await Lead.findOne({
      where: { uuid, ...buildLeadScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lead) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('lead_not_found'));
    }
    if (lead.status === LEAD_STATUSES.CONVERTED) {
      // Idempotent: already converted — nothing more to do.
      return;
    }

    const organizationId = lead.organization_id;
    const ownerId = lead.owner_id || req.auth.userId;

    // 1) Account: attach to an existing one (by uuid), or create from company fields when
    //    the lead is B2B. B2C leads (no company) simply skip account creation.
    let accountId = null;
    if (body.account_uuid) {
      const account = await Account.findOne({
        where: { uuid: body.account_uuid, ...buildAccountScope(req) },
        attributes: ['id'],
        transaction,
      });
      if (!account) {
        throw new ApiError(httpStatus.NOT_FOUND, res.__('account_not_found'));
      }
      accountId = account.id;
    } else if (lead.company_name) {
      const account_number = await nextSequenceCode(Account, ACCOUNT_CODE_PREFIX, transaction);
      const account = await Account.create(
        {
          account_number,
          organization_id: organizationId,
          owner_id: ownerId,
          created_by_id: req.auth.userId,
          name: lead.company_name,
          industry: lead.industry || null,
          website: lead.website || null,
          custom_fields: {},
        },
        { transaction }
      );
      accountId = account.id;
    }

    // 2) Contact from the lead's person fields (attached to the account if B2B).
    const contact = await Contact.create(
      {
        organization_id: organizationId,
        account_id: accountId,
        owner_id: ownerId,
        created_by_id: req.auth.userId,
        first_name: lead.first_name,
        last_name: lead.last_name || null,
        email: lead.email || null,
        phone: lead.phone || null,
        job_title: lead.job_title || null,
        is_primary: Boolean(accountId),
        custom_fields: {},
      },
      { transaction }
    );

    // 3) Optional Deal on a pipeline (defaulted from SalesConfig if not specified).
    let dealId = null;
    if (body.create_deal) {
      const dealInput = body.deal || {};
      let pipeline;
      if (dealInput.pipeline_uuid) {
        pipeline = await SalesPipeline.findOne({
          where: { uuid: dealInput.pipeline_uuid, organization_id: organizationId },
          transaction,
        });
      } else {
        pipeline = await SalesPipeline.findOne({
          where: { organization_id: organizationId, is_default: true },
          transaction,
        });
      }
      if (!pipeline) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_pipeline_not_found'));
      }
      // Stage: explicit, else the pipeline's first stage.
      const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
      const stageKey = dealInput.stage_key || (stages[0] && stages[0].key);
      const stage = getStageOrThrow(pipeline, stageKey);

      const deal_number = await nextSequenceCode(Deal, DEAL_CODE_PREFIX, transaction);
      const deal = await Deal.create(
        {
          deal_number,
          organization_id: organizationId,
          owner_id: ownerId,
          created_by_id: req.auth.userId,
          pipeline_id: pipeline.id,
          stage_key: stage.key,
          account_id: accountId,
          contact_id: contact.id,
          source_lead_id: lead.id,
          title: dealInput.title || `${lead.first_name}${lead.company_name ? ' — ' + lead.company_name : ''}`,
          amount: dealInput.amount ?? lead.estimated_value ?? 0,
          currency: dealInput.currency || lead.currency || DEFAULT_CURRENCY,
          probability: stage.probability ?? 0,
          expected_close_date: dealInput.expected_close_date || null,
          status: statusFromStage(stage),
          custom_fields: {},
        },
        { transaction }
      );
      dealId = deal.id;

      await DealEvent.create(
        {
          organization_id: organizationId,
          deal_id: deal.id,
          created_by_id: req.auth.userId,
          entry_type: DEAL_EVENT_TYPES.CREATED,
          from_value: null,
          to_value: stage.key,
          note: 'Created from lead conversion',
        },
        { transaction }
      );
    }

    // 4) Mark the lead converted + link the created records.
    lead.status = LEAD_STATUSES.CONVERTED;
    lead.converted_account_id = accountId;
    lead.converted_contact_id = contact.id;
    lead.converted_deal_id = dealId;
    lead.converted_at = new Date();
    await lead.save({ transaction });

    await LeadEvent.create(
      {
        organization_id: organizationId,
        lead_id: lead.id,
        created_by_id: req.auth.userId,
        entry_type: LEAD_EVENT_TYPES.CONVERTED,
        from_value: null,
        to_value: LEAD_STATUSES.CONVERTED,
        note: null,
      },
      { transaction }
    );
  });

  // Return the converted lead + its now-linked records for the client.
  const lead = await Lead.findOne({
    where: { uuid, ...buildLeadScope(req) },
    attributes: LEAD_ATTRIBUTES,
    include: [
      ...LEAD_INCLUDE,
      { model: Account, as: 'convertedAccount', attributes: ['uuid', 'account_number', 'name'] },
      { model: Contact, as: 'convertedContact', attributes: ['uuid', 'first_name', 'last_name'] },
      { model: Deal, as: 'convertedDeal', attributes: ['uuid', 'deal_number', 'title', 'amount', 'currency', 'status'] },
    ],
  });
  return lead;
};

/** Delete a lead and its events (owner/manager action). */
const deleteLead = async (uuid, req, res) => {
  const lead = await findVisibleLead(uuid, req, res);
  await sequelize.transaction(async (transaction) => {
    await LeadEvent.destroy({ where: { lead_id: lead.id }, transaction });
    await Lead.destroy({ where: { id: lead.id }, transaction });
  });
};

module.exports = {
  LEAD_ATTRIBUTES,
  listLeads,
  findVisibleLead,
  getLeadByUuid,
  createLead,
  updateLead,
  assignLead,
  convertLead,
  deleteLead,
};
