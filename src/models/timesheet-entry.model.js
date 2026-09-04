const { DataTypes } = require('sequelize');
const { HOURS_MIN, HOURS_MAX } = require('../utils/timesheet.constants');

/**
 * TimesheetEntry = one day's logged hours within a weekly Timesheet.
 *
 * A Timesheet owns exactly 7 of these (Sunday..Saturday), matching the 7 rows in the
 * "Submit Timesheet" screen. Splitting the days into their own table (rather than a
 * JSONB blob on the timesheet) keeps daily hours queryable/aggregatable for future
 * payroll and reporting, and lets the DB enforce the per-day uniqueness + hour bounds.
 *
 * organization_id is denormalized from the parent timesheet so day-level reporting
 * stays tenant-scoped without a join back to timesheets.
 *
 * Uniqueness: (timesheet_id, work_date) — one entry per day per timesheet.
 *
 * Relationships:
 *   Timesheet    1───* TimesheetEntry     (timesheet_id)
 *   Organization 1───* TimesheetEntry     (organization_id, denormalized)
 */
module.exports = (sequelize) => {
  const TimesheetEntry = sequelize.define(
    'TimesheetEntry',
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

      timesheet_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'timesheets', key: 'id' },
        onDelete: 'CASCADE',
      },

      // Denormalized tenant anchor (always the parent timesheet's organization).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // The calendar day this entry covers (one of the 7 days in the parent's week).
      work_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // Hours logged for the day. DECIMAL(4,2) covers 0.00..24.00 with quarter-hour
      // precision; bounds are enforced here AND in validation.
      hours: {
        type: DataTypes.DECIMAL(4, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: HOURS_MIN, max: HOURS_MAX },
      },

      // Optional per-day note ("Write note..." in the UI).
      note: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
    },
    {
      tableName: 'timesheet_entries',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // One entry per day per timesheet.
        { unique: true, fields: ['timesheet_id', 'work_date'] },
        { fields: ['timesheet_id'] },
        // Powers day-level reporting/aggregation within a tenant (future payroll).
        { fields: ['organization_id', 'work_date'] },
      ],
    }
  );

  return TimesheetEntry;
};
