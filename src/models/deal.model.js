const { DataTypes } = require('sequelize');
const { DEAL_STATUSES, DEFAULT_CURRENCY } = require('../utils/sales.constants');

/**
 * Deal (Opportunity) = a revenue opportunity moving through a pipeline (the money-bearing,
 * audited core of the module).
 *
 * Pipeline & stage: pipeline_id references a SalesPipeline; stage_key points at one of
 * that pipeline's stages[] entries. Moving stage recomputes `status` from the stage's
 * is_won/is_lost flags and writes an immutable DealEvent — same shape as the ATS
 * application status/stage transition writing ApplicationEvent.
 *
 * Multi-currency (product-owner decision §0.7): each deal carries its OWN currency;
 * amounts are DECIMAL(14,2) — never float.
 *
 * B2B + B2C + lead-origin: account_id, contact_id and source_lead_id are ALL nullable.
 * An account-less deal (only a contact, or standalone) is fully supported (§0.8).
 *
 * Visibility: sales_rep sees own deals (owner_id); sales_manager / org_admin
 * (deal.manage_all) see the whole org; super_admin spans orgs.
 *
 * Relationships:
 *   Organization  1───* Deal        (organization_id)
 *   SalesPipeline 1───* Deal        (pipeline_id)
 *   Account       1───* Deal        (account_id, nullable)
 *   Contact       1───* Deal        (contact_id, nullable)
 *   Lead          1───* Deal        (source_lead_id, nullable — origin)
 *   User(owner)   1───* Deal        (owner_id)
 *   Deal          1───* DealEvent   (deal_id)
 */
module.exports = (sequelize) => {
  const Deal = sequelize.define(
    'Deal',
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

      deal_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      owner_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      pipeline_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'sales_pipelines', key: 'id' },
      },

      // Points at one of the pipeline's stages[].key. Validated against the pipeline
      // at the service layer on create and every stage move.
      stage_key: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },

      // ── Links (all nullable — B2B, B2C, or standalone) ───────────────────────
      account_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'accounts', key: 'id' },
      },

      contact_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'contacts', key: 'id' },
      },

      // The lead this deal originated from (set during conversion).
      source_lead_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'leads', key: 'id' },
      },

      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 200] },
      },

      amount: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },

      // Per-deal currency (multi-currency).
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: DEFAULT_CURRENCY,
      },

      // 0–100. Seeded from the stage's probability on entry, overridable per deal.
      probability: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 100 },
      },

      expected_close_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      // Set when the deal lands on a terminal (won/lost) stage.
      closed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Derived from the current stage's is_won/is_lost; stored for cheap filtering.
      status: {
        type: DataTypes.ENUM(...Object.values(DEAL_STATUSES)),
        allowNull: false,
        defaultValue: DEAL_STATUSES.OPEN,
      },

      custom_fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: 'deals',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['deal_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'owner_id'] },
        // Powers the Kanban board query (deals grouped by stage within a pipeline).
        { fields: ['organization_id', 'pipeline_id', 'stage_key'] },
        { fields: ['organization_id', 'expected_close_date'] },
        { fields: ['account_id'] },
        { fields: ['contact_id'] },
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Deal;
};
