const httpStatus = require('http-status');
const { SalesConfig, SalesPipeline } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { normalizeStages } = require('./sales.shared');
const {
  DEFAULT_SALES_FEATURES,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_NAME,
  SALES_CURRENCIES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_MAX_PER_ENTITY,
} = require('../../utils/sales.constants');

/**
 * Sales configuration service.
 *
 * Phase 0 responsibility: provision an organization's sales configuration — one
 * SalesConfig row plus a default pipeline — idempotently. Called on org creation and
 * from the RBAC seeder to backfill pre-existing orgs (mirrors
 * leaveService.ensureDefaultLeaveTypes). Full config CRUD (feature-flag toggles, custom
 * fields, source editing) lands in Phase 1 on top of this.
 *
 * These are SYSTEM operations (not tenant-scoped by the middleware): the caller passes
 * the organizationId explicitly and a transaction.
 */

/**
 * Ensure an org has a SalesConfig and at least one default pipeline. Idempotent.
 * Returns the SalesConfig row.
 */
const ensureSalesConfig = async (organizationId, createdById = null, transaction) => {
  // 1) Ensure a default pipeline exists first, so we can point defaults at it.
  const [pipeline] = await SalesPipeline.findOrCreate({
    where: { organization_id: organizationId, is_default: true },
    defaults: {
      organization_id: organizationId,
      created_by_id: createdById,
      name: DEFAULT_PIPELINE_NAME,
      // Normalize the defaults through the same guardrail user-supplied stages pass
      // through (exactly one won + one lost, sequential order, unique keys).
      stages: normalizeStages(DEFAULT_PIPELINE_STAGES),
      is_default: true,
      is_active: true,
    },
    transaction,
  });

  // 2) Ensure the config row, defaulting the pipeline pointer + currency + sources.
  const [config, created] = await SalesConfig.findOrCreate({
    where: { organization_id: organizationId },
    defaults: {
      organization_id: organizationId,
      features: DEFAULT_SALES_FEATURES,
      defaults: {
        default_pipeline_id: pipeline.id,
        currency: DEFAULT_CURRENCY,
        fiscal_year_start_month: 1,
      },
      lead_sources: DEFAULT_LEAD_SOURCES,
      custom_fields: { lead: [], account: [], contact: [], deal: [] },
    },
    transaction,
  });

  // 3) Backfill the default pipeline pointer if an older config predates this pipeline.
  if (!created && !config.defaults?.default_pipeline_id) {
    config.defaults = { ...config.defaults, default_pipeline_id: pipeline.id };
    await config.save({ transaction });
  }

  return config;
};

/**
 * Read the org's config (creating it lazily) plus a summary of its pipelines, for the
 * settings screen. Tenant-scoped: organizationId comes from req.auth.
 */
const getSalesConfig = async (req) => {
  const organizationId = req.auth.organizationId;
  const config = await ensureSalesConfig(organizationId, req.auth.userId);
  const pipelines = await SalesPipeline.findAll({
    where: { organization_id: organizationId },
    attributes: ['uuid', 'name', 'is_default', 'is_active'],
    order: [['is_default', 'DESC'], ['created_at', 'ASC']],
  });
  return { config, pipelines };
};

/** Validate a lead-sources array: [{ key, label, active }] with unique keys. */
const validateLeadSources = (sources, res) => {
  if (!Array.isArray(sources)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_sources'));
  }
  const slugify = (v) =>
    String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const seen = new Set();
  return sources.map((s) => {
    const label = String(s.label || '').trim();
    // Derive the key from the explicit key when present, else from the label (a newly
    // added source arrives with a blank key). Label is what's required from the user.
    const key = slugify(s.key) || slugify(label);
    if (!key || !label) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_sources'));
    }
    if (seen.has(key)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_sources'));
    }
    seen.add(key);
    return { key, label, active: s.active !== false };
  });
};

/**
 * Validate the per-entity custom-field DEFINITIONS. Each entity maps to an array of
 * { key, label, type, options?, required? }. Keys unique per entity; type must be known;
 * select/multiselect require options. This is the schema for the values validated on each
 * record by sales.shared.validateCustomFields.
 */
const validateCustomFieldDefs = (customFields, res) => {
  const out = {};
  for (const entity of CUSTOM_FIELD_ENTITIES) {
    const defs = Array.isArray(customFields?.[entity]) ? customFields[entity] : [];
    if (defs.length > CUSTOM_FIELD_MAX_PER_ENTITY) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_too_many_fields'));
    }
    const slugify = (v) =>
      String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const seen = new Set();
    out[entity] = defs.map((d) => {
      const label = String(d.label || '').trim();
      // Derive the key from the explicit key when present, else from the label.
      const key = slugify(d.key) || slugify(label);
      const type = String(d.type || '').trim();
      if (!key || !label || !Object.values(CUSTOM_FIELD_TYPES).includes(type)) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_field'));
      }
      if (seen.has(key)) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_field'));
      }
      seen.add(key);
      const def = { key, label, type, required: Boolean(d.required) };
      if (type === CUSTOM_FIELD_TYPES.SELECT || type === CUSTOM_FIELD_TYPES.MULTISELECT) {
        const options = Array.isArray(d.options) ? d.options.map((o) => String(o)).filter(Boolean) : [];
        if (!options.length) {
          throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_field'));
        }
        def.options = options;
      }
      return def;
    });
  }
  return out;
};

/**
 * Update the org's config: feature flags, defaults (default pipeline / currency / fiscal
 * month), lead sources, and custom-field definitions. Only provided sections change.
 * default_pipeline_uuid is resolved to an internal id within the tenant.
 */
const updateSalesConfig = async (body, req, res) => {
  const organizationId = req.auth.organizationId;
  const config = await ensureSalesConfig(organizationId, req.auth.userId);

  if (body.features !== undefined) {
    // Merge onto known flags so unknown keys can't be injected.
    const merged = { ...DEFAULT_SALES_FEATURES, ...config.features };
    for (const key of Object.keys(DEFAULT_SALES_FEATURES)) {
      if (body.features[key] !== undefined) merged[key] = Boolean(body.features[key]);
    }
    config.features = merged;
  }

  if (body.defaults !== undefined) {
    const defaults = { ...config.defaults };
    if (body.defaults.currency !== undefined) {
      if (!SALES_CURRENCIES.includes(body.defaults.currency)) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_currency'));
      }
      defaults.currency = body.defaults.currency;
    }
    if (body.defaults.fiscal_year_start_month !== undefined) {
      const m = Number(body.defaults.fiscal_year_start_month);
      if (!Number.isInteger(m) || m < 1 || m > 12) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_config_invalid_fiscal_month'));
      }
      defaults.fiscal_year_start_month = m;
    }
    if (body.defaults.default_pipeline_uuid !== undefined) {
      const pipeline = await SalesPipeline.findOne({
        where: { uuid: body.defaults.default_pipeline_uuid, organization_id: organizationId },
        attributes: ['id'],
      });
      if (!pipeline) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('sales_pipeline_not_found'));
      }
      defaults.default_pipeline_id = pipeline.id;
    }
    config.defaults = defaults;
  }

  if (body.lead_sources !== undefined) {
    config.lead_sources = validateLeadSources(body.lead_sources, res);
  }

  if (body.custom_fields !== undefined) {
    config.custom_fields = validateCustomFieldDefs(body.custom_fields, res);
  }

  await config.save();
  return getSalesConfig(req);
};

module.exports = {
  ensureSalesConfig,
  getSalesConfig,
  updateSalesConfig,
};
