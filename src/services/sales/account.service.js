const httpStatus = require('http-status');
const {
  Account,
  Contact,
  Deal,
  SalesConfig,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { ACCOUNT_QUERY_CONFIG } = require('../../config/query-configs');
const { ACCOUNT_CODE_PREFIX } = require('../../utils/sales.constants');
const {
  buildAccountScope,
  nextSequenceCode,
  validateCustomFields,
} = require('./sales.shared');
const { ensureSalesConfig } = require('./sales-config.service');

/**
 * account.service — business logic for accounts (companies, the B2B anchor).
 *
 * Visibility follows the sales owner overlay (buildAccountScope): a sales_rep sees only
 * accounts they own; a sales_manager / org_admin (account.manage_all) sees the whole org.
 * organization_id and owner defaults are derived server-side, never trusted from the body.
 *
 * getAccountByUuid returns an "Account 360": the account plus its contacts and deals, so
 * a rep sees the whole relationship in one call (a read-time composition, no new storage).
 */

const ACCOUNT_ATTRIBUTES = [
  'id',
  'uuid',
  'account_number',
  'organization_id',
  'owner_id',
  'created_by_id',
  'name',
  'industry',
  'website',
  'phone',
  'email',
  'address',
  'annual_revenue',
  'employee_count',
  'account_type',
  'custom_fields',
  'createdAt',
  'updatedAt',
];

const ACCOUNT_INCLUDE = [
  { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
];

const getConfig = async (organizationId, transaction) => {
  const existing = await SalesConfig.findOne({ where: { organization_id: organizationId }, transaction });
  if (existing) return existing;
  return ensureSalesConfig(organizationId, null, transaction);
};

/** Resolve a user by public uuid within the caller's tenant (for owner assignment). */
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

/** List accounts (tenant + owner scoped). */
const listAccounts = async (req) =>
  paginate(Account, req.query, ACCOUNT_QUERY_CONFIG, {
    scopeWhere: buildAccountScope(req),
    attributes: ACCOUNT_ATTRIBUTES,
    include: ACCOUNT_INCLUDE,
  });

/** Fetch an account the caller may see, or throw 404. */
const findVisibleAccount = async (uuid, req, res, transaction) => {
  const account = await Account.findOne({
    where: { uuid, ...buildAccountScope(req) },
    attributes: ACCOUNT_ATTRIBUTES,
    include: ACCOUNT_INCLUDE,
    transaction,
  });
  if (!account) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('account_not_found'));
  }
  return account;
};

/** Read one account with its contacts + deals (the Account 360 view). */
const getAccountByUuid = async (uuid, req, res) => {
  const account = await findVisibleAccount(uuid, req, res);
  const contacts = await Contact.findAll({
    where: { account_id: account.id, organization_id: account.organization_id },
    attributes: ['uuid', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'is_primary'],
    order: [['is_primary', 'DESC'], ['created_at', 'ASC']],
  });
  const deals = await Deal.findAll({
    where: { account_id: account.id, organization_id: account.organization_id },
    attributes: ['uuid', 'deal_number', 'title', 'amount', 'currency', 'status', 'stage_key', 'probability', 'expected_close_date'],
    order: [['created_at', 'DESC']],
  });
  return { account, contacts, deals };
};

/** Create an account. owner defaults to the creator; a manager may pass owner_uuid. */
const createAccount = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const account = await sequelize.transaction(async (transaction) => {
    const config = await getConfig(organizationId, transaction);
    const custom = validateCustomFields(body.custom_fields, config.custom_fields?.account);

    let ownerId = req.auth.userId;
    if (body.owner_uuid) {
      ownerId = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }

    const account_number = await nextSequenceCode(Account, ACCOUNT_CODE_PREFIX, transaction);
    return Account.create(
      {
        account_number,
        organization_id: organizationId,
        owner_id: ownerId,
        created_by_id: req.auth.userId,
        name: body.name,
        industry: body.industry || null,
        website: body.website || null,
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        annual_revenue: body.annual_revenue ?? null,
        employee_count: body.employee_count ?? null,
        account_type: body.account_type || null,
        custom_fields: custom,
      },
      { transaction }
    );
  });

  return getAccountByUuid(account.uuid, req, res);
};

/** Update an account's fields. */
const updateAccount = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const account = await Account.findOne({
      where: { uuid, ...buildAccountScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!account) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('account_not_found'));
    }

    const scalarFields = [
      'name', 'industry', 'website', 'phone', 'email', 'address',
      'annual_revenue', 'employee_count', 'account_type',
    ];
    for (const f of scalarFields) {
      if (body[f] !== undefined) account[f] = body[f];
    }
    if (body.owner_uuid !== undefined) {
      account.owner_id = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }
    if (body.custom_fields !== undefined) {
      const config = await getConfig(account.organization_id, transaction);
      account.custom_fields = validateCustomFields(body.custom_fields, config.custom_fields?.account);
    }
    await account.save({ transaction });
  });

  return getAccountByUuid(uuid, req, res);
};

/**
 * Delete an account. Deals/contacts reference it; to avoid orphaned FKs we detach them
 * (set account_id null) rather than cascade-deleting a company's whole history. A rep
 * deleting a company shouldn't silently destroy its deals.
 */
const deleteAccount = async (uuid, req, res) => {
  const account = await findVisibleAccount(uuid, req, res);
  await sequelize.transaction(async (transaction) => {
    await Contact.update(
      { account_id: null },
      { where: { account_id: account.id, organization_id: account.organization_id }, transaction }
    );
    await Deal.update(
      { account_id: null },
      { where: { account_id: account.id, organization_id: account.organization_id }, transaction }
    );
    await Account.destroy({ where: { id: account.id }, transaction });
  });
};

module.exports = {
  ACCOUNT_ATTRIBUTES,
  listAccounts,
  findVisibleAccount,
  getAccountByUuid,
  createAccount,
  updateAccount,
  deleteAccount,
};
