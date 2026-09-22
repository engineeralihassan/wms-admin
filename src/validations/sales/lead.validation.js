const Joi = require('joi');
const {
  LEAD_STATUSES,
  SALES_CURRENCIES,
  LEAD_NAME_MAX_LENGTH,
  LEAD_COMPANY_MAX_LENGTH,
  SHORT_TEXT_MAX_LENGTH,
  DEAL_TITLE_MAX_LENGTH,
  MONEY_MAX,
} = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Lead endpoints. organization_id, created_by and (by default)
 * owner are derived from the token, never the body. custom_fields shape is validated
 * loosely here (it's a free object) and deeply against the org's field definitions in
 * the service (validateCustomFields) — the same split the ATS uses for pipelines.
 */

const money = Joi.number().min(0).max(MONEY_MAX).precision(2);
const currency = Joi.string().valid(...SALES_CURRENCIES);
// custom_fields is an open object; the service validates keys/types against SalesConfig.
const customFields = Joi.object().unknown(true);

const leadBodyBase = {
  first_name: Joi.string().trim().min(1).max(LEAD_NAME_MAX_LENGTH),
  last_name: Joi.string().trim().max(LEAD_NAME_MAX_LENGTH).allow('', null),
  email: Joi.string().trim().email().max(255).allow('', null),
  phone: Joi.string().trim().max(40).allow('', null),
  job_title: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  company_name: Joi.string().trim().max(LEAD_COMPANY_MAX_LENGTH).allow('', null),
  industry: Joi.string().trim().max(SHORT_TEXT_MAX_LENGTH).allow('', null),
  website: Joi.string().trim().max(500).allow('', null),
  source: Joi.string().trim().max(60).allow('', null),
  estimated_value: money.allow(null),
  currency: currency.allow(null),
  custom_fields: customFields,
};

/** POST /sales/leads — first_name required; owner_uuid optional (manager assignment). */
const createLead = {
  body: Joi.object().keys({
    ...leadBodyBase,
    first_name: Joi.string().trim().min(1).max(LEAD_NAME_MAX_LENGTH).required(),
    owner_uuid: Joi.string().uuid().optional(),
  }),
};

/** GET /sales/leads — paginated, filterable list. */
const listLeads = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(LEAD_STATUSES)),
        source: Joi.string().max(60),
        owner_id: Joi.number().integer(),
        currency,
      })
      .unknown(true),
  }),
};

const getLead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** PATCH /sales/leads/:uuid — at least one field; status transition allowed. */
const updateLead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      ...leadBodyBase,
      status: Joi.string().valid(...Object.values(LEAD_STATUSES)),
    })
    .min(1),
};

/** POST /sales/leads/:uuid/assign — reassign the owner. */
const assignLead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    owner_uuid: Joi.string().uuid().required(),
  }),
};

/**
 * POST /sales/leads/:uuid/convert — turn into account/contact/(deal).
 * account_uuid attaches to an existing account; otherwise the company fields (if any)
 * create one. create_deal opts into creating an opportunity on a pipeline.
 */
const convertLead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    account_uuid: Joi.string().uuid().optional(),
    create_deal: Joi.boolean().default(false),
    // The deal details are ALWAYS optional. When create_deal is true and no deal object
    // is supplied, the service creates one on the org's default pipeline (first stage),
    // deriving title/amount/currency from the lead. Callers may pass a deal object to
    // override any of those.
    deal: Joi.object()
      .keys({
        title: Joi.string().trim().max(DEAL_TITLE_MAX_LENGTH),
        amount: money,
        currency,
        pipeline_uuid: Joi.string().uuid(),
        stage_key: Joi.string().trim().max(60),
        expected_close_date: Joi.date().iso(),
      })
      .unknown(false)
      .optional(),
  }),
};

const deleteLead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  createLead,
  listLeads,
  getLead,
  updateLead,
  assignLead,
  convertLead,
  deleteLead,
};
