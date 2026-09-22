const httpStatus = require('http-status');
const {
  Contact,
  Account,
  Deal,
  SalesConfig,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { CONTACT_QUERY_CONFIG } = require('../../config/query-configs');
const {
  buildContactScope,
  buildAccountScope,
  validateCustomFields,
} = require('./sales.shared');
const { ensureSalesConfig } = require('./sales-config.service');

/**
 * contact.service — business logic for contacts (people).
 *
 * B2B: a contact belongs to an Account (account_id set). B2C: account_id is null, so a
 * standalone individual is a first-class record. Visibility follows the account overlay
 * (buildContactScope): a rep sees own contacts; account.manage_all sees the whole org.
 *
 * is_primary is enforced at the service layer: setting a contact primary clears the flag
 * on the other contacts of the SAME account (a company has one primary contact). B2C
 * contacts (null account) never collide because the rule is scoped to an account_id.
 */

const CONTACT_ATTRIBUTES = [
  'id',
  'uuid',
  'organization_id',
  'account_id',
  'owner_id',
  'created_by_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'is_primary',
  'custom_fields',
  'createdAt',
  'updatedAt',
];

const CONTACT_INCLUDE = [
  { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: Account, as: 'account', attributes: ['uuid', 'account_number', 'name'] },
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

/** Resolve an account by uuid within the caller's account scope (nullable — B2C). */
const resolveAccountId = async (accountUuid, req, res, transaction) => {
  if (!accountUuid) return null;
  const account = await Account.findOne({
    where: { uuid: accountUuid, ...buildAccountScope(req) },
    attributes: ['id'],
    transaction,
  });
  if (!account) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('account_not_found'));
  }
  return account.id;
};

/**
 * If this contact is primary, clear is_primary on the account's other contacts so only
 * one primary exists per account. No-op for B2C (null account) contacts.
 */
const enforceSinglePrimary = async (contact, transaction) => {
  if (!contact.is_primary || !contact.account_id) return;
  await Contact.update(
    { is_primary: false },
    {
      where: {
        account_id: contact.account_id,
        organization_id: contact.organization_id,
        id: { [require('sequelize').Op.ne]: contact.id },
      },
      transaction,
    }
  );
};

/** List contacts (tenant + owner scoped). */
const listContacts = async (req) =>
  paginate(Contact, req.query, CONTACT_QUERY_CONFIG, {
    scopeWhere: buildContactScope(req),
    attributes: CONTACT_ATTRIBUTES,
    include: CONTACT_INCLUDE,
  });

/** Fetch a contact the caller may see, or throw 404. */
const findVisibleContact = async (uuid, req, res, transaction) => {
  const contact = await Contact.findOne({
    where: { uuid, ...buildContactScope(req) },
    attributes: CONTACT_ATTRIBUTES,
    include: CONTACT_INCLUDE,
    transaction,
  });
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('contact_not_found'));
  }
  return contact;
};

/** Read one contact (with account + owner). */
const getContactByUuid = async (uuid, req, res) => {
  const contact = await findVisibleContact(uuid, req, res);
  return { contact };
};

/** Create a contact (account optional for B2C). */
const createContact = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const contact = await sequelize.transaction(async (transaction) => {
    const config = await getConfig(organizationId, transaction);
    const custom = validateCustomFields(body.custom_fields, config.custom_fields?.contact);
    const accountId = await resolveAccountId(body.account_uuid, req, res, transaction);

    let ownerId = req.auth.userId;
    if (body.owner_uuid) {
      ownerId = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }

    const created = await Contact.create(
      {
        organization_id: organizationId,
        account_id: accountId,
        owner_id: ownerId,
        created_by_id: req.auth.userId,
        first_name: body.first_name,
        last_name: body.last_name || null,
        email: body.email || null,
        phone: body.phone || null,
        job_title: body.job_title || null,
        is_primary: Boolean(body.is_primary),
        custom_fields: custom,
      },
      { transaction }
    );
    await enforceSinglePrimary(created, transaction);
    return created;
  });

  return getContactByUuid(contact.uuid, req, res);
};

/** Update a contact's fields (including re-parenting to another account, or detaching). */
const updateContact = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const contact = await Contact.findOne({
      where: { uuid, ...buildContactScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!contact) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('contact_not_found'));
    }

    const scalarFields = ['first_name', 'last_name', 'email', 'phone', 'job_title'];
    for (const f of scalarFields) {
      if (body[f] !== undefined) contact[f] = body[f];
    }
    if (body.account_uuid !== undefined) {
      contact.account_id = body.account_uuid
        ? await resolveAccountId(body.account_uuid, req, res, transaction)
        : null;
    }
    if (body.owner_uuid !== undefined) {
      contact.owner_id = await resolveOrgUserId(body.owner_uuid, req, res, transaction);
    }
    if (body.is_primary !== undefined) contact.is_primary = Boolean(body.is_primary);
    if (body.custom_fields !== undefined) {
      const config = await getConfig(contact.organization_id, transaction);
      contact.custom_fields = validateCustomFields(body.custom_fields, config.custom_fields?.contact);
    }
    await contact.save({ transaction });
    await enforceSinglePrimary(contact, transaction);
  });

  return getContactByUuid(uuid, req, res);
};

/** Delete a contact. Deals referencing it are detached (contact_id null), not destroyed. */
const deleteContact = async (uuid, req, res) => {
  const contact = await findVisibleContact(uuid, req, res);
  await sequelize.transaction(async (transaction) => {
    await Deal.update(
      { contact_id: null },
      { where: { contact_id: contact.id, organization_id: contact.organization_id }, transaction }
    );
    await Contact.destroy({ where: { id: contact.id }, transaction });
  });
};

module.exports = {
  CONTACT_ATTRIBUTES,
  listContacts,
  findVisibleContact,
  getContactByUuid,
  createContact,
  updateContact,
  deleteContact,
};
