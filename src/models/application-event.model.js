const { DataTypes } = require('sequelize');
const { APPLICATION_EVENT_TYPES } = require('../utils/ats.constants');

/**
 * ApplicationEvent = one immutable entry in a job application's audit trail.
 *
 * Every meaningful change to an application (creation, status move, interview-stage
 * change, note, rating) appends a row here, so the full hiring history is
 * reconstructable and disputes are traceable. Mirrors the leave balance ledger.
 *
 * Rows are append-only; they are never updated or deleted independently of their
 * parent application. from_value/to_value hold whichever pair the entry_type concerns
 * (status or stage_key), kept generic so new event types need no schema change.
 *
 * Relationships:
 *   Organization    1───* ApplicationEvent   (organization_id)
 *   JobApplication  1───* ApplicationEvent   (application_id)
 *   User(actor)     1───* ApplicationEvent   (created_by_id, nullable for system/public)
 */
module.exports = (sequelize) => {
  const ApplicationEvent = sequelize.define(
    'ApplicationEvent',
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

      // Multi-tenancy anchor.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'job_applications', key: 'id' },
      },

      // Who performed the action. Null for the public "created" event (candidate).
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      entry_type: {
        type: DataTypes.ENUM(...Object.values(APPLICATION_EVENT_TYPES)),
        allowNull: false,
      },

      // The transition captured, whichever the entry concerns (status or stage).
      from_value: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      to_value: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      // Free-text note (recruiter comment or context for the change).
      note: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },
    },
    {
      tableName: 'application_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['application_id'] },
        { fields: ['application_id', 'created_at'] },
      ],
    }
  );

  return ApplicationEvent;
};
