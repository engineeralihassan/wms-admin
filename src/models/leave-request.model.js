const { DataTypes } = require('sequelize');
const { LEAVE_STATUSES, LEAVE_DAY_PORTIONS } = require('../utils/leave.constants');

/**
 * LeaveRequest = a tenant-scoped leave / time-off application submitted by a user.
 * Closely mirrors the Expense model: draft -> submitted -> approved | rejected, plus
 * withdrawn (by applicant) and cancelled (by approver).
 *
 * Multi-tenancy: every request references organization_id and is scoped at the
 * service layer (tenantScope middleware + buildLeaveScope), so one tenant can never
 * see another tenant's leave. super_admin is the only actor able to read across orgs.
 *
 * Ownership & workflow:
 *   - created_by_id is the applicant (owner). A normal user only sees/edits their own
 *     requests; an approver (leave.approve) sees all requests in their org.
 *   - Once submitted, paid days are held in the balance's `pending` bucket. On approve
 *     they move to `used`; on reject/withdraw/cancel they are released.
 *
 * Timesheet readiness: start_date/end_date (DATEONLY) + day_portion + decimal
 * total_days are designed so a future Timesheet module can cheaply ask "is this user
 * on leave on date X" via getLeaveDays() and block time entry — no schema change.
 *
 * Relationships:
 *   Organization  1───* LeaveRequest   (organization_id)
 *   User(applicant) 1─* LeaveRequest   (created_by_id)
 *   User(reviewer)  1─* LeaveRequest   (reviewed_by_id — nullable until decided)
 *   LeaveType     1───* LeaveRequest   (leave_type_id)
 */
module.exports = (sequelize) => {
  const LeaveRequest = sequelize.define(
    'LeaveRequest',
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

      // Human-friendly identifier (e.g. "LV-000123"). Unique across the platform.
      leave_number: {
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

      // The applicant / owner of the request.
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // The approver who decided (nullable until decided).
      reviewed_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      // Which kind of leave (carries is_paid / requires_balance).
      leave_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'leave_types', key: 'id' },
      },

      // Inclusive leave date range.
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      // Portion of the day. v1 uses 'full'; halves reserved for future half-day leave.
      day_portion: {
        type: DataTypes.ENUM(...Object.values(LEAVE_DAY_PORTIONS)),
        allowNull: false,
        defaultValue: LEAVE_DAY_PORTIONS.FULL,
      },

      // Number of leave days this request consumes (computed server-side; excludes
      // weekends). DECIMAL so half-days need no schema change later.
      total_days: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },

      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 2000] },
      },

      status: {
        type: DataTypes.ENUM(...Object.values(LEAVE_STATUSES)),
        allowNull: false,
        defaultValue: LEAVE_STATUSES.DRAFT,
      },

      // Attachments: metadata only for now (file name). JSONB array of { name }
      // objects; open for future fields (key/size/mime/url) when object storage
      // (S3 presigned URLs) is added — no schema change needed.
      attachments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      // Set when the applicant moves the request from draft -> submitted.
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Set when an approver approves or rejects.
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Required when an approver rejects; surfaced back to the applicant.
      rejection_reason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
    },
    {
      tableName: 'leave_requests',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['leave_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'created_by_id'] },
        { fields: ['organization_id', 'reviewed_by_id'] },
        { fields: ['organization_id', 'leave_type_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
        // Timesheet-critical: fast range scans of a user's leave days. Explicit short
        // names so Postgres never truncates them (which breaks idempotent sync re-runs).
        {
          name: 'leave_requests_org_user_daterange_ix',
          fields: ['organization_id', 'created_by_id', 'start_date', 'end_date'],
        },
        // Org-wide calendar range scans.
        {
          name: 'leave_requests_org_daterange_ix',
          fields: ['organization_id', 'start_date', 'end_date'],
        },
      ],
    }
  );

  return LeaveRequest;
};
