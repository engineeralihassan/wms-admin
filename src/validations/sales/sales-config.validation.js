const Joi = require('joi');
const {
  SALES_CURRENCIES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_KEY_MAX_LENGTH,
  CUSTOM_FIELD_LABEL_MAX_LENGTH,
  CUSTOM_FIELD_MAX_PER_ENTITY,
} = require('../../utils/sales.constants');

/**
 * Validation for the sales configuration endpoints. Shape is validated here; the service
 * applies the semantic rules (known feature flags only, valid currency/month, unique
 * source/field keys, options required for select types).
 */

const featureFlags = Joi.object().pattern(Joi.string(), Joi.boolean());

const defaults = Joi.object({
  default_pipeline_uuid: Joi.string().uuid().allow(null),
  currency: Joi.string().valid(...SALES_CURRENCIES),
  fiscal_year_start_month: Joi.number().integer().min(1).max(12),
}).unknown(false);

const leadSource = Joi.object({
  // key is optional/derivable: the service slugifies it from the label when blank, so a
  // newly-added source (no key yet) is valid. allow('') so the client can send key:''.
  key: Joi.string().trim().max(60).allow('').optional(),
  label: Joi.string().trim().min(1).max(120).required(),
  active: Joi.boolean(),
}).unknown(false);

const customFieldDef = Joi.object({
  // Same as lead sources: key is derived from label when blank.
  key: Joi.string().trim().max(CUSTOM_FIELD_KEY_MAX_LENGTH).allow('').optional(),
  label: Joi.string().trim().min(1).max(CUSTOM_FIELD_LABEL_MAX_LENGTH).required(),
  type: Joi.string().valid(...Object.values(CUSTOM_FIELD_TYPES)).required(),
  options: Joi.array().items(Joi.string().trim().min(1).max(120)).max(100),
  required: Joi.boolean(),
}).unknown(false);

const customFieldsByEntity = Joi.object({
  lead: Joi.array().items(customFieldDef).max(CUSTOM_FIELD_MAX_PER_ENTITY),
  account: Joi.array().items(customFieldDef).max(CUSTOM_FIELD_MAX_PER_ENTITY),
  contact: Joi.array().items(customFieldDef).max(CUSTOM_FIELD_MAX_PER_ENTITY),
  deal: Joi.array().items(customFieldDef).max(CUSTOM_FIELD_MAX_PER_ENTITY),
}).unknown(false);

const getConfig = {
  query: Joi.object().keys({}),
};

const updateConfig = {
  body: Joi.object()
    .keys({
      features: featureFlags,
      defaults,
      lead_sources: Joi.array().items(leadSource).max(100),
      custom_fields: customFieldsByEntity,
    })
    .min(1),
};

module.exports = { getConfig, updateConfig };
