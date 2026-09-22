const { DataTypes } = require('sequelize');
const { DEAL_EVENT_TYPES } = require('../utils/sales.constants');

/**
 * DealEvent = one immutable entry in a deal's audit trail.
 *
 * Every meaningful change to a deal (creation, stage move, owner change, amount change,
 * won/lost, note) appends a row here, so the full sales history is reconstructable and
 * disputes are traceable. Directly modeled on ApplicationEvent (the ATS audit trail).
 *
 * Rows are append-only; never updated or deleted independently of their parent deal.
 * from_value/to_value hold whichever pair the entry_type concerns (stage_key, status,
 * owner, amount), kept generic so new event types need no schema change.
 *
 * Relationships:
 *   Organization 1───* DealEvent   (organization_id)
 *   Deal         1───* DealEvent   (deal_id)
 *   User(actor)  1───* DealEvent   (created_by_id, nullable for system)
 */
module.exports = (sequelize) => {
  const DealEvent = sequelize.define(
    'DealEvent',
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

      deal_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'deals', key: 'id' },
      },

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      entry_type: {
        type: DataTypes.ENUM(...Object.values(DEAL_EVENT_TYPES)),
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
      tableName: 'deal_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['deal_id'] },
        { fields: ['deal_id', 'created_at'] },
      ],
    }
  );

  return DealEvent;
};
