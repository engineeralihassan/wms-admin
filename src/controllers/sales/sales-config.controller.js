const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { salesConfigService } = require('../../services');

/** Shape the config (+ pipeline summary) for API responses. Internal ids are not exposed. */
const toDto = (config, pipelines) => ({
  features: config.features || {},
  defaults: {
    // Expose the default pipeline by uuid, not internal id.
    default_pipeline_uuid:
      (pipelines.find((p) => p.is_default) || {}).uuid || null,
    currency: config.defaults?.currency || null,
    fiscal_year_start_month: config.defaults?.fiscal_year_start_month || 1,
  },
  lead_sources: config.lead_sources || [],
  custom_fields: config.custom_fields || { lead: [], account: [], contact: [], deal: [] },
  pipelines: pipelines.map((p) => ({
    uuid: p.uuid,
    name: p.name,
    is_default: p.is_default,
    is_active: p.is_active,
  })),
});

/** GET /sales/config — the org's sales configuration. */
const getConfig = catchAsync(async (req, res) => {
  const { config, pipelines } = await salesConfigService.getSalesConfig(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: toDto(config, pipelines) });
});

/** PATCH /sales/config — update flags/defaults/sources/custom fields. */
const updateConfig = catchAsync(async (req, res) => {
  const { config, pipelines } = await salesConfigService.updateSalesConfig(req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_config_updated'), data: toDto(config, pipelines) });
});

module.exports = { toDto, getConfig, updateConfig };
