const { DataTypes } = require('sequelize');
const { TIMESHEET_STATUSES } = require('../utils/timesheet.constants');

/**
 * Timesheet = ONE user's week of work against ONE project (the weekly container).
 *
 * The long-lived entity is the existing Project; a Timesheet is a weekly slice of work
 * logged against it. A 1-year project therefore spawns ~52 weekly timesheets per
 * member. Each Timesheet owns 7 TimesheetEntry rows (Sunday..Saturday).
 *
 * Multi-tenancy: every timesheet references organization_id and is scoped by the
 * service layer (tenantScope middleware + buildTimesheetScope). One tenant can never
 * see another tenant's timesheets; super_admin is the only cross-org reader.
 *
 * Ownership & workflow:
 *   - user_id (== created_by_id semantics) is the owner. A normal user sees/edits only
 *     their own timesheets; an approver (timesheet.approve) sees all in their org.
 *   - reviewed_by_id is the approver who decided/corrected it (nullable).
 *   - Lifecycle: unsubmitted -> submitted -> approved | rejected, plus locked when the
 *     lock date passes while still unsubmitted (see timesheet.constants).
 *
 * total_hours is a DENORMALIZED cache of the sum of the week's entries, kept in sync by
 * the service on every entry write. It powers the "Total Hours" column in the list view
 * without loading all 7 entries per row.
 *
 * Uniqueness: (project_id, user_id, week_start_date) — exactly one timesheet per person,
 * per project, per week. This also makes weekly auto-generation idempotent (a re-run
 * can never create a duplicate).
 *
 * Relationships:
 *   Organization 1───* Timesheet          (organization_id)
 *   Project      1───* Timesheet          (project_id)
 *   User(owner)  1───* Timesheet          (user_id)
 *   User(reviewer) 1─* Timesheet          (reviewed_by_id — nullable)
 *   Timesheet    1───* TimesheetEntry     (the 7 daily rows)
 */
module.exports = (sequelize) => {
  const Timesheet = sequelize.define(
    'Timesheet',
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

      // Human-friendly identifier (e.g. "TS-000123"). Unique across the platform.
      timesheet_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // The project this week of work is logged against.
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
      },

      // The owner of the timesheet (the person logging hours).
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // The approver (project manager / org admin) who decided or corrected it.
      reviewed_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      // The Sunday that starts this week (the anchor of the weekly window).
      week_start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // The Saturday that ends this week (week_start_date + 6). Stored for cheap
      // range queries and display, always derived server-side.
      week_end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // The submission deadline (Saturday, per the business cadence).
      due_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // The hard cutoff (the following Tuesday). After this, only an approver may edit.
      lock_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // Denormalized sum of the week's entry hours. DECIMAL(6,2) comfortably covers a
      // full 168h week with a fraction. Kept in sync by the service on every write.
      total_hours: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
      },

      status: {
        type: DataTypes.ENUM(...Object.values(TIMESHEET_STATUSES)),
        allowNull: false,
        defaultValue: TIMESHEET_STATUSES.UNSUBMITTED,
      },

      // Set when the owner moves the sheet from unsubmitted -> submitted.
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Set when an approver approves/rejects.
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Required when an approver rejects; surfaced back to the owner.
      rejection_reason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },

      // Optional free-text note the approver leaves when correcting/accepting a sheet
      // ("changed Thursday from 6h to 8h for correctness").
      review_note: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },

      // Idempotency markers for the reminder sweep: which reminder kinds were already
      // queued for this sheet (e.g. { due_soon: true, due_today: true }). JSONB so new
      // reminder kinds need no schema change.
      reminders_sent: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },

      // Whether this week was created automatically by the weekly generator (vs. an
      // on-demand create). Purely informational / for auditing.
      auto_generated: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'timesheets',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['timesheet_number'] },
        // One timesheet per person, per project, per week (also guards auto-gen).
        { unique: true, fields: ['project_id', 'user_id', 'week_start_date'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'user_id'] },
        { fields: ['organization_id', 'project_id'] },
        { fields: ['organization_id', 'reviewed_by_id'] },
        // The reminder/lock sweeps scan open sheets by their date windows.
        { fields: ['organization_id', 'week_start_date'] },
        { fields: ['status', 'due_date'] },
        { fields: ['status', 'lock_date'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Timesheet;
};
