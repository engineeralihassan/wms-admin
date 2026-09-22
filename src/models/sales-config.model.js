const { DataTypes } = require('sequelize');
const {
  DEFAULT_SALES_FEATURES,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_CURRENCY,
} = require('../utils/sales.constants');

/**
 * SalesConfig = one row per organization holding the module's per-tenant configuration.
 *
 * This is what makes the Sales module "dynamic, not stuck to one company": the variable
 * parts of a sales process live here as JSONB (feature flags, defaults, lead sources,
 * custom-field definitions) rather than as hardcoded columns. Core entities stay
 * strongly typed; only the CONFIGURATION is data. Same philosophy as Job.interview_rounds.
 *
 * Created lazily via salesConfigService.ensureSalesConfig(orgId) on first access, and
 * backfilled for pre-existing orgs by the RBAC seeder (mirrors ensureDefaultLeaveTypes).
 *
 * Relationships:
 *   Organization 1───1 SalesConfig   (organization_id, unique)
 */
module.exports = (sequelize) => {
  const SalesConfig = sequelize.define(
    'SalesConfig',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },

      uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        unique: true,
      },

      // Multi-tenancy anchor — one config per organization.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'organizations', key: 'id' },
      },

      // Feature flags: which sales sub-features are enabled for this org. The frontend
      // nav renders a sub-feature only when its flag is ON and the user holds the perm.
      features: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: DEFAULT_SALES_FEATURES,
      },

      // Create-time defaults: { default_pipeline_id, currency, fiscal_year_start_month }.
      // currency here is only the pre-selected default; each deal carries its own currency.
      defaults: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: { default_pipeline_id: null, currency: DEFAULT_CURRENCY, fiscal_year_start_month: 1 },
      },

      // Editable lead-source list: [{ key, label, active }]. Leads validate `source`
      // against the active keys here.
      lead_sources: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: DEFAULT_LEAD_SOURCES,
      },

      // Per-entity custom-field DEFINITIONS (the values live on each row's custom_fields):
      // { lead:[{key,label,type,options?,required?}], account:[...], contact:[...], deal:[...] }.
      custom_fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: { lead: [], account: [], contact: [], deal: [] },
      },
    },
    {
      tableName: 'sales_configs',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['organization_id'] },
      ],
    }
  );

  return SalesConfig;
};
