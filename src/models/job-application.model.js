const { DataTypes } = require('sequelize');
const {
  APPLICATION_STATUSES,
  APPLICATION_SOURCES,
  SCREENING_STATUSES,
} = require('../utils/ats.constants');

/**
 * JobApplication = one candidate's submission against a Job.
 *
 * Origin: created through the PUBLIC careers page (no auth) by the candidate. The
 * organization_id is copied from the parent Job at creation so the row is tenant-scoped
 * exactly like every other domain table (the recruiter reads it through tenantScope).
 *
 * Candidate identity lives here (name/email/phone/links) rather than in the users table
 * — an applicant is NOT a platform user. The CV and any supporting files are stored via
 * the polymorphic attachments table (owner_type = 'job_application', owner_id = this id).
 *
 * Workflow: the recruiter who owns the job (or an org admin) moves `status` through the
 * ATS lifecycle; while INTERVIEWING, `stage_key` points at one of the parent job's
 * interview_rounds. Every change writes an immutable ApplicationEvent row.
 *
 * Relationships:
 *   Organization   1───* JobApplication      (organization_id)
 *   Job            1───* JobApplication      (job_id)
 *   User(reviewer) 1───* JobApplication      (reviewed_by_id, nullable)
 *   JobApplication 1───* ApplicationEvent    (application_id)
 */
module.exports = (sequelize) => {
  const JobApplication = sequelize.define(
    'JobApplication',
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

      // Human-friendly identifier (e.g. "APP-000123"). Unique across the platform.
      application_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor (denormalized from the parent job for fast scoped listing).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // The job applied to.
      job_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'jobs', key: 'id' },
      },

      // The recruiter/admin who last acted on the application (nullable until acted on).
      reviewed_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      // ── Candidate-supplied identity ──────────────────────────────────────────
      candidate_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 150] },
      },

      candidate_email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true, isEmail: true },
      },

      candidate_phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      // Optional profile links (LinkedIn, portfolio, GitHub, etc.).
      linkedin_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      portfolio_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      // Candidate's stated years of experience (optional, self-reported).
      experience_years: {
        type: DataTypes.DECIMAL(4, 1),
        allowNull: true,
        validate: { min: 0, max: 80 },
      },

      // Candidate's cover note / message.
      cover_note: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 5000] },
      },

      // ── Recruiter-managed workflow ─────────────────────────────────────────────
      status: {
        type: DataTypes.ENUM(...Object.values(APPLICATION_STATUSES)),
        allowNull: false,
        defaultValue: APPLICATION_STATUSES.NEW,
      },

      // Which interview round the application currently sits in (references one of the
      // parent job's interview_rounds[].key). Null unless status is INTERVIEWING.
      stage_key: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      // Recruiter's candidate rating (1–5). Nullable until set.
      rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 5 },
      },

      // Reason captured on a terminal/hold decision (e.g. rejection reason).
      decision_reason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },

      source: {
        type: DataTypes.ENUM(...Object.values(APPLICATION_SOURCES)),
        allowNull: false,
        defaultValue: APPLICATION_SOURCES.CAREERS_PAGE,
      },

      // ── Resume screening (populated asynchronously by the resume worker) ────────

      // Where the screening pipeline is for this application.
      screening_status: {
        type: DataTypes.ENUM(...Object.values(SCREENING_STATUSES)),
        allowNull: false,
        defaultValue: SCREENING_STATUSES.PENDING,
      },

      // Final 0–100 fit score from the matcher (Rezmatch). Highest = best match.
      // Indexed for fast "top N" ordering within a job. Null until screened.
      screening_score: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 100 },
      },

      // Score band label: 'excellent' | 'strong' | 'good' | 'fair' | 'weak'.
      screening_band: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      // Explainable breakdown from the matcher so recruiters see WHY a candidate scored
      // as they did: { band, summary, met_requirements[], missed_requirements[],
      //   notes, provider, request_id }.
      screening_breakdown: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      // When screening last completed (or failed). Lets us detect a stale score after
      // the job description / criteria changed and re-enqueue.
      screened_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'job_applications',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['application_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['job_id'] },
        { fields: ['job_id', 'status'] },
        { fields: ['organization_id', 'candidate_email'] },
        // Supports the default list ordering (created_at DESC) within a job/tenant.
        { fields: ['organization_id', 'created_at'] },
        // Supports the "top N candidates" ranking query: order by score within a job.
        { fields: ['job_id', 'screening_score'] },
      ],
    }
  );

  return JobApplication;
};
