const { DataTypes } = require('sequelize');
const {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
} = require('../utils/opportunity.constants');

/**
 * Opportunity = a normalized, org-scoped record discovered from an external source
 * (currently the OpenWeb Ninja JSearch job-search API). Users review discovered
 * opportunities and convert promising ones into Sales Leads.
 *
 * Multi-tenancy: organization_id is the tenant anchor, scoped at the service layer via
 * opportunity.shared.buildOpportunityScope (tenantScope middleware + owner overlay),
 * exactly like the sales module. discovered_by_id owns the discovery.
 *
 * Idempotency: (organization_id, source, external_id) is UNIQUE — re-running the same
 * search upserts instead of creating duplicates (last_seen_at bumped, status preserved).
 *
 * Untrusted content: title/description and other source strings are external data. The
 * service caps their length before persisting and the API never renders them as HTML.
 *
 * Relationships:
 *   Organization 1───* Opportunity   (organization_id)
 *   User(discoverer) 1───* Opportunity (discovered_by_id)
 *   Opportunity 0..1─ Lead           (converted_lead_id, set on conversion)
 */
module.exports = (sequelize) => {
  const Opportunity = sequelize.define(
    'Opportunity',
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

      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // Who ran the discovery that surfaced this opportunity (owner for scope).
      discovered_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // ── Provenance (idempotency key: org + source + external_id) ──────────────
      source: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },

      // Stable id from the source (JSearch job_id). Used to de-duplicate on re-search.
      external_id: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },

      opportunity_type: {
        type: DataTypes.ENUM(...Object.values(OPPORTUNITY_TYPES)),
        allowNull: false,
        defaultValue: OPPORTUNITY_TYPES.JOB,
      },

      // ── Normalized content (all capped by the service; external = untrusted) ──
      title: {
        type: DataTypes.STRING(300),
        allowNull: false,
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      company_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      company_website: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },

      employment_type: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      location: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      is_remote: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Money is stored as-provided by the source (may be null). DECIMAL, never float.
      salary_min: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
      },

      salary_max: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
      },

      salary_currency: {
        type: DataTypes.STRING(3),
        allowNull: true,
      },

      salary_period: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      // Human-friendly salary text as provided by the source (e.g. "150K–200K a year").
      // Preferred for display since the numeric fields often lack a currency.
      salary_display: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      // The publisher/apply link and provenance link (always shown for attribution).
      apply_url: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },

      source_url: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },

      publisher: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // When the source says it was posted (may be null), and when we discovered it.
      posted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      discovered_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      // Bumped every time the same opportunity is seen again in a later search.
      last_seen_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      status: {
        type: DataTypes.ENUM(...Object.values(OPPORTUNITY_STATUSES)),
        allowNull: false,
        defaultValue: OPPORTUNITY_STATUSES.NEW,
      },

      // The search query text that surfaced this opportunity (audit / grouping).
      search_query: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },

      // The complete, untrusted source payload — kept for debugging / reprocessing.
      raw_payload: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      // Set when status -> converted.
      converted_lead_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'leads', key: 'id' },
      },

      converted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'opportunities',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // Idempotency: one row per (tenant, source, external id).
        { unique: true, fields: ['organization_id', 'source', 'external_id'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'discovered_by_id'] },
        { fields: ['organization_id', 'discovered_at'] },
      ],
    }
  );

  return Opportunity;
};
