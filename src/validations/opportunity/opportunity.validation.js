const Joi = require('joi');
const { listQuery } = require('../common.validation');
const {
  OPPORTUNITY_QUERY_MIN,
  OPPORTUNITY_QUERY_MAX,
  OPPORTUNITY_USER_SETTABLE_STATUSES,
  DATE_POSTED_VALUES,
  EMPLOYMENT_TYPES,
} = require('../../utils/opportunity.constants');

/**
 * Run a discovery search. `query` is required free-form text (title + location works
 * best per the API docs). The other params are forwarded to JSearch; num_pages is
 * additionally capped by config on the server so a client can't force a large credit spend.
 */
const discover = {
  body: Joi.object().keys({
    query: Joi.string().trim().min(OPPORTUNITY_QUERY_MIN).max(OPPORTUNITY_QUERY_MAX).required(),
    // ISO 3166-1 alpha-2 country code (e.g. "us", "de").
    country: Joi.string().trim().lowercase().length(2),
    date_posted: Joi.string().valid(...DATE_POSTED_VALUES),
    work_from_home: Joi.boolean(),
    // Comma-delimited subset of the allowed employment types.
    employment_types: Joi.string().custom((value, helpers) => {
      const parts = String(value)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!parts.length || parts.some((p) => !EMPLOYMENT_TYPES.includes(p))) {
        return helpers.error('any.invalid');
      }
      return parts.join(',');
    }),
    num_pages: Joi.number().integer().min(1).max(20),
  }),
};

const listOpportunities = {
  query: Joi.object().keys(listQuery),
};

const getOpportunity = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const setStatus = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({
    status: Joi.string()
      .valid(...OPPORTUNITY_USER_SETTABLE_STATUSES)
      .required(),
  }),
};

const deleteOpportunity = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

// Convert to a lead. All fields optional overrides; the service derives sensible
// defaults from the opportunity when omitted.
const convertToLead = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({
    first_name: Joi.string().trim().max(150),
    company_name: Joi.string().trim().max(200),
    estimated_value: Joi.number().min(0),
  }),
};

module.exports = {
  discover,
  listOpportunities,
  getOpportunity,
  setStatus,
  deleteOpportunity,
  convertToLead,
};
