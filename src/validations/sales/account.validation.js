const Joi = require('joi');
const {
  ACCOUNT_NAME_MAX_LENGTH,
  SHORT_TEXT_MAX_LENGTH,
  MONEY_MAX,
} = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Account endpoints. organization_id and created_by are derived
 * from the token; owner defaults to the creator unless a manager passes owner_uuid.
 * custom_fields is an open object here, deep-validated in the service against SalesConfig.
 */

const money = Joi.number().min(0).max(MONEY_MAX).precision(2);
const customFields = Joi.object().unknown(true);

// Structured address (all parts optional).
const address = Joi.object({
  line1: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  line2: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  city: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  state: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  postal_code: Joi.string().trim().max(30).allow('', null),
  country: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
}).unknown(false);

const accountBodyBase = {
  name: Joi.string().trim().min(1).max(ACCOUNT_NAME_MAX_LENGTH),
  industry: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  website: Joi.string().trim().max(500).allow('', null),
  phone: Joi.string().trim().max(40).allow('', null),
  email: Joi.string().trim().email().max(255).allow('', null),
  address: address.allow(null),
  annual_revenue: money.allow(null),
  employee_count: Joi.number().integer().min(0).allow(null),
  account_type: Joi.string().trim().max(60).allow('', null),
  custom_fields: customFields,
  owner_uuid: Joi.string().uuid(),
};

const createAccount = {
  body: Joi.object().keys({
    ...accountBodyBase,
    name: Joi.string().trim().min(1).max(ACCOUNT_NAME_MAX_LENGTH).required(),
  }),
};

const listAccounts = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        owner_id: Joi.number().integer(),
        industry: Joi.string().max(SHORT_TEXT_MAX_LENGTH),
        account_type: Joi.string().max(60),
      })
      .unknown(true),
  }),
};

const getAccount = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updateAccount = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys(accountBodyBase).min(1),
};

const deleteAccount = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
};
