const { DataTypes } = require('sequelize');
const {
  JOB_STATUSES,
  JOB_EMPLOYMENT_TYPES,
  JOB_WORK_MODES,
  JOB_CURRENCIES,
  JOB_SALARY_PERIODS,
} = require('../utils/ats.constants');

/**
 * Job = a tenant-scoped job opening posted by a recruiter (the ATS core).
 *
 * Multi-tenancy: every job references organization_id and is scoped at the service
 * layer (tenantScope middleware + buildJobScope), so one tenant never sees another's
 * jobs. super_admin is the only actor able to read across organizations.
 *
 * Ownership & visibility:
 *   - created_by_id is the recruiter who posted it (owner). A recruiter sees/edits only
 *     their OWN jobs; an org admin (job.manage_all) sees every job in the org. This
 *     overlay lives in the service, mirroring project.manage / leave.approve.
 *
 * Public careers page:
 *   - public_token is an unguessable random slug used for the shareable link
 *     (/careers/:public_token). We route on the token — never the uuid or id — so the
 *     public surface can't be enumerated from an internal identifier.
 *   - Only status OPEN renders the description + apply form; CLOSED/FILLED show a
 *     friendly "not accepting applications" / "position filled" message; DRAFT is
 *     treated as not-found publicly (never leak an unpublished job).
 *
 * Interview pipeline:
 *   - interview_rounds is a recruiter-defined ORDERED list of { key, name, order }.
 *     An application's stage_key points at one of these rounds while INTERVIEWING.
 *
 * Relationships:
 *   Organization   1───* Job              (organization_id)
 *   User(recruiter) 1──* Job              (created_by_id)
 *   Job            1───* JobApplication   (job_id)
 */
module.exports = (sequelize) => {
  const Job = sequelize.define(
    'Job',
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

      // Human-friendly identifier (e.g. "JOB-000123"). Unique across the platform.
      job_code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Unguessable slug for the public careers link (/careers/:public_token).
      public_token: {
        type: DataTypes.STRING(64),
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

      // The recruiter who posted / owns the job.
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 200] },
      },

      // Full job description rendered on the public careers page (rich text / markdown).
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true, len: [1, 20000] },
      },

      department: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      location: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      employment_type: {
        type: DataTypes.ENUM(...Object.values(JOB_EMPLOYMENT_TYPES)),
        allowNull: false,
        defaultValue: JOB_EMPLOYMENT_TYPES.FULL_TIME,
      },

      work_mode: {
        type: DataTypes.ENUM(...Object.values(JOB_WORK_MODES)),
        allowNull: false,
        defaultValue: JOB_WORK_MODES.ONSITE,
      },

      // Experience range in years. Integers; max nullable for "5+ years".
      experience_min: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 60 },
      },

      experience_max: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 60 },
      },

      // Salary range. DECIMAL(14,2) — never float — so money is exact. Nullable/optional.
      salary_min: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        validate: { min: 0 },
      },

      salary_max: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        validate: { min: 0 },
      },

      currency: {
        type: DataTypes.ENUM(...JOB_CURRENCIES),
        allowNull: true,
      },

      salary_period: {
        type: DataTypes.ENUM(...Object.values(JOB_SALARY_PERIODS)),
        allowNull: true,
      },

      // Whether the salary range is shown on the public page.
      show_salary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Number of positions open for this listing.
      openings: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: { min: 1, max: 9999 },
      },

      // Required/desired skills. JSONB array of trimmed strings.
      skills: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      // Recruiter-defined ordered interview pipeline: [{ key, name, order }].
      interview_rounds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      status: {
        type: DataTypes.ENUM(...Object.values(JOB_STATUSES)),
        allowNull: false,
        defaultValue: JOB_STATUSES.DRAFT,
      },

      // Set when the job is first published (draft -> open).
      published_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Set when the job is closed or marked filled.
      closed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'jobs',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['job_code'] },
        { unique: true, fields: ['public_token'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'created_by_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Job;
};
