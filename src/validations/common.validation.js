const Joi = require('joi');

/**
 * Shared Joi schema for list query params (pagination + sort + search).
 *
 * This only guards shape/bounds; the actual sortBy/searchable field names are
 * allow-listed in the query layer (config/query-configs.js), so an invalid sortBy
 * is safely ignored rather than injected. Spread this into a route's query schema.
 */
const listQuery = {
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  sortBy: Joi.string().max(50),
  sortDir: Joi.string().valid('asc', 'desc', 'ASC', 'DESC'),
  search: Joi.string().allow('').max(200),
  cursor: Joi.string().max(500),
  filters: Joi.object().unknown(true),
};

module.exports = { listQuery };
