const { DataTypes } = require('sequelize');
const { LEAD_EVENT_TYPES } = require('../utils/sales.constants');

/**
 * LeadEvent = one immutable entry in a lead's audit trail.
 *
 * Mirrors DealEvent / ApplicationEvent. Captures lead creation, status changes, owner
 * (re)assignment, conversion, and notes so the full lead history is reconstructable.
 * Append-only; from_value/to_value hold whichever pair the entry_type concerns.
 *
 * Relationships:
 *   Organization 1───* LeadEvent   (organization_id)
 *   Lead         1───* LeadEvent   (lead_id)
 *   User(actor)  1───* LeadEvent   (created_by_id, nullable for system)
 */
module.exports = (sequelize) => {
  const LeadEvent = sequelize.define(
    'LeadEvent',
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

      lead_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'leads', key: 'id' },
      },

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      entry_type: {
        type: DataTypes.ENUM(...Object.values(LEAD_EVENT_TYPES)),
        allowNull: false,
      },

      from_value: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      to_value: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      note: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
    },
    {
      tableName: 'lead_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['lead_id'] },
        { fields: ['lead_id', 'created_at'] },
      ],
    }
  );

  return LeadEvent;
};
