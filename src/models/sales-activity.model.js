const { DataTypes } = require('sequelize');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  RELATED_TYPES,
} = require('../utils/sales.constants');

/**
 * SalesActivity = one logged interaction or task in the sales workflow (call, meeting,
 * email, note, task, follow-up).
 *
 * Polymorphic parent: an activity attaches to a lead / account / contact / deal via
 * (related_type, related_id) — the SAME approach as the polymorphic attachments table,
 * resolved at the service layer rather than by a hard FK. This keeps one activity table
 * and one timeline component serving every entity.
 *
 * Task behavior: for task/follow_up types, `due_at` + `status` (open/completed/cancelled)
 * drive the "my tasks" and "overdue" views. Historical types (call/meeting/email/note)
 * are logged as completed records.
 *
 * Visibility: an activity is visible to whoever can see its related record (re-checked in
 * the service); it also carries owner_id for the rep's own-activity views.
 *
 * Relationships:
 *   Organization 1───* SalesActivity   (organization_id)
 *   User(owner)  1───* SalesActivity   (owner_id)
 *   (related_type, related_id) -> lead | account | contact | deal (polymorphic, no FK)
 */
module.exports = (sequelize) => {
  const SalesActivity = sequelize.define(
    'SalesActivity',
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

      // Polymorphic parent (resolved in the service — deliberately no FK).
      related_type: {
        type: DataTypes.ENUM(...Object.values(RELATED_TYPES)),
        allowNull: false,
      },

      related_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      activity_type: {
        type: DataTypes.ENUM(...Object.values(ACTIVITY_TYPES)),
        allowNull: false,
      },

      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 255] },
      },

      body: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 5000] },
      },

      // Due date for task/follow_up types (null for historical log entries).
      due_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Lifecycle for task-type activities; non-task types default to completed.
      status: {
        type: DataTypes.ENUM(...Object.values(ACTIVITY_STATUSES)),
        allowNull: false,
        defaultValue: ACTIVITY_STATUSES.COMPLETED,
      },
    },
    {
      tableName: 'sales_activities',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        // Powers the per-record timeline (all activities for a given lead/deal/etc.).
        { fields: ['related_type', 'related_id'] },
        // Powers the "my tasks / follow-ups" and "overdue" views.
        { fields: ['organization_id', 'owner_id', 'due_at'] },
        { fields: ['organization_id', 'status', 'due_at'] },
      ],
    }
  );

  return SalesActivity;
};
