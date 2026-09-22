const Joi = require('joi');
const {
  DEAL_STATUSES,
  SALES_CURRENCIES,
  DEAL_TITLE_MAX_LENGTH,
  PIPELINE_STAGE_KEY_MAX_LENGTH,
  MONEY_MAX,
  PROBABILITY_MIN,
  PROBABILITY_MAX,
} = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Deal endpoints. organization_id/created_by derived from the
 * token; owner defaults to the creator unless a manager passes owner_uuid. Pipeline,
 * account and contact are referenced by public uuid and resolved (scoped) in the service.
 * Stage validity against the pipeline is enforced in the service (getStageOrThrow).
 */

const money = Joi.number().min(0).max(MONEY_MAX).precision(2);
const currency = Joi.string().valid(...SALES_CURRENCIES);
const probability = Joi.number().integer().min(PROBABILITY_MIN).max(PROBABILITY_MAX);
const stageKey = Joi.string().trim().min(1).max(PIPELINE_STAGE_KEY_MAX_LENGTH);
const customFields = Joi.object().unknown(true);

const dealBodyBase = {
  title: Joi.string().trim().min(1).max(DEAL_TITLE_MAX_LENGTH),
  amount: money,
  currency,
  probability,
  expected_close_date: Joi.date().iso().allow(null),
  account_uuid: Joi.string().uuid().allow(null),
  contact_uuid: Joi.string().uuid().allow(null),
  custom_fields: customFields,
  owner_uuid: Joi.string().uuid(),
};

/** POST /sales/deals — title required; pipeline defaults to the org default if omitted. */
const createDeal = {
  body: Joi.object().keys({
    ...dealBodyBase,
    title: Joi.string().trim().min(1).max(DEAL_TITLE_MAX_LENGTH).required(),
    pipeline_uuid: Joi.string().uuid().optional(),
    stage_key: stageKey.optional(),
  }),
};

const listDeals = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(DEAL_STATUSES)),
        stage_key: stageKey,
        pipeline_id: Joi.number().integer(),
        owner_id: Joi.number().integer(),
        account_id: Joi.number().integer(),
        currency,
      })
      .unknown(true),
  }),
};

/** GET /sales/deals/board?pipeline=<uuid> — Kanban columns for a pipeline. */
const board = {
  query: Joi.object().keys({
    pipeline: Joi.string().uuid().optional(),
  }),
};

const getDeal = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updateDeal = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys(dealBodyBase).min(1),
};

/** POST /sales/deals/:uuid/stage — move to another stage (probability override optional). */
const changeStage = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({
    stage_key: stageKey.required(),
    probability: probability.optional(),
    note: Joi.string().trim().max(2000).allow('', null),
  }),
};

/** POST /sales/deals/:uuid/reassign — change the owner. */
const reassignDeal = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({ owner_uuid: Joi.string().uuid().required() }),
};

const deleteDeal = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createDeal,
  listDeals,
  board,
  getDeal,
  updateDeal,
  changeStage,
  reassignDeal,
  deleteDeal,
};
