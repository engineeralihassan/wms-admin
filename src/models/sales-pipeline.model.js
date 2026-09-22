const { DataTypes } = require('sequelize');

/**
 * SalesPipeline = a per-org, named, ordered set of deal stages.
 *
 * This is the dynamic sales pipeline: `stages` is a JSONB array — the SAME pattern as
 * Job.interview_rounds — normalized by salesShared.normalizeStages() into canonical
 * [{ key, name, order, probability, is_won, is_lost }] with sequential 1-based order,
 * unique keys, and exactly one is_won + one is_lost terminal stage. A Deal.stage_key
 * points at one of these. No stage table, no per-tenant schema change: a pipeline is data.
 *
 * An org may have several pipelines (e.g. "New Business", "Renewals"); one is marked
 * is_default and used when a deal is created without an explicit pipeline.
 *
 * Relationships:
 *   Organization  1───* SalesPipeline   (organization_id)
 *   SalesPipeline 1───* Deal            (pipeline_id)
 */
module.exports = (sequelize) => {
  const SalesPipeline = sequelize.define(
    'SalesPipeline',
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

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 150] },
      },

      // Ordered stages: [{ key, name, order, probability, is_won, is_lost }].
      stages: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      // The pipeline used when a deal is created without an explicit pipeline.
      is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'sales_pipelines',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'is_default'] },
      ],
    }
  );

  return SalesPipeline;
};
