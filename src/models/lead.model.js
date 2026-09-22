const { DataTypes } = require('sequelize');
const { LEAD_STATUSES } = require('../utils/sales.constants');

/**
 * Lead = an early / unqualified prospect (the top of the sales funnel).
 *
 * B2B + B2C in one model: a lead may stand ALONE (B2C — a person with no company) or
 * carry company fields that become an Account on conversion (B2B). All company fields
 * are nullable so B2C never needs a fake company.
 *
 * Multi-tenancy: organization_id is the tenant anchor, scoped at the service layer via
 * salesShared.buildSalesScope (tenantScope middleware + owner overlay). A sales_rep sees
 * only leads they own (owner_id); a sales_manager / org_admin (lead.manage_all) sees the
 * whole org. super_admin spans all orgs.
 *
 * Conversion: leads.convert creates Account + Contact (+ optional Deal) in a transaction,
 * sets status=converted and the converted_* pointers, and writes a LeadEvent.
 *
 * AI (Phase 4, reserved now, nullable): ai_score / ai_band / ai_breakdown / ai_scored_at
 * mirror job_applications.screening_* — populated once by a worker, cached, read for free.
 *
 * Relationships:
 *   Organization 1───* Lead        (organization_id)
 *   User(owner)  1───* Lead        (owner_id, nullable until assigned)
 *   User(creator)1───* Lead        (created_by_id)
 *   Lead         1───* LeadEvent   (lead_id)
 *   Lead         0..1─ Account/Contact/Deal (converted_* pointers)
 */
module.exports = (sequelize) => {
  const Lead = sequelize.define(
    'Lead',
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

      // Human-friendly identifier (e.g. "LEAD-000123"). Unique across the platform.
      lead_number: {
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

      // Assigned sales rep (nullable until assigned).
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

      // ── Person fields ──────────────────────────────────────────────────────
      first_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 150] },
      },

      last_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },

      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: { isEmailOrEmpty(value) { if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error('Invalid email'); } },
      },

      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      job_title: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      // ── Company fields (B2B; all nullable for B2C) ───────────────────────────
      company_name: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      industry: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      website: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      // Source key, validated against SalesConfig.lead_sources at the service layer.
      source: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      status: {
        type: DataTypes.ENUM(...Object.values(LEAD_STATUSES)),
        allowNull: false,
        defaultValue: LEAD_STATUSES.NEW,
      },

      // Rep's rough deal-size estimate. DECIMAL(14,2) — never float — with its own currency.
      estimated_value: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        validate: { min: 0 },
      },

      currency: {
        type: DataTypes.STRING(3),
        allowNull: true,
      },

      // Per-org custom fields (validated against SalesConfig.custom_fields.lead defs).
      custom_fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },

      // ── Conversion pointers (set when status -> converted) ───────────────────
      converted_account_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'accounts', key: 'id' },
      },

      converted_contact_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'contacts', key: 'id' },
      },

      converted_deal_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'deals', key: 'id' },
      },

      converted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // ── AI (Phase 4; reserved, nullable — mirrors job_applications.screening_*) ─
      ai_score: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },

      ai_band: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      ai_breakdown: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      ai_scored_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'leads',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['lead_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'owner_id'] },
        { fields: ['organization_id', 'created_at'] },
        // Supports the "top N by AI score" ranking query (Phase 4).
        { fields: ['organization_id', 'ai_score'] },
      ],
    }
  );

  return Lead;
};
