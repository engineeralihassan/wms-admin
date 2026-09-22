const Joi = require('joi');
const {
  CONTACT_NAME_MAX_LENGTH,
  SHORT_TEXT_MAX_LENGTH,
} = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Contact endpoints. account_uuid is optional (null = B2C /
 * standalone). owner defaults to the creator unless a manager passes owner_uuid.
 * custom_fields is deep-validated in the service against SalesConfig.
 */

const customFields = Joi.object().unknown(true);

const contactBodyBase = {
  first_name: Joi.string().trim().min(1).max(CONTACT_NAME_MAX_LENGTH),
  last_name: Joi.string().trim().max(CONTACT_NAME_MAX_LENGTH).allow('', null),
  email: Joi.string().trim().email().max(255).allow('', null),
  phone: Joi.string().trim().max(40).allow('', null),
  job_title: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  is_primary: Joi.boolean(),
  // Null/empty allowed so a B2B contact can be detached to standalone (B2C).
  account_uuid: Joi.string().uuid().allow(null),
  owner_uuid: Joi.string().uuid(),
  custom_fields: customFields,
};

const createContact = {
  body: Joi.object().keys({
    ...contactBodyBase,
    first_name: Joi.string().trim().min(1).max(CONTACT_NAME_MAX_LENGTH).required(),
  }),
};

const listContacts = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        owner_id: Joi.number().integer(),
        account_id: Joi.number().integer(),
        is_primary: Joi.boolean(),
      })
      .unknown(true),
  }),
};

const getContact = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updateContact = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys(contactBodyBase).min(1),
};

const deleteContact = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createContact,
  listContacts,
  getContact,
  updateContact,
  deleteContact,
};
