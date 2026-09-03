const { DataTypes } = require('sequelize');

/**
 * ResumeScreeningJob = one durable unit of resume-screening work (a DB-backed queue).
 *
 * Mirrors EmailJob (src/models/email-job.model.js): the apply flow enqueues a row and
 * returns immediately; a background worker later claims 'pending' jobs, downloads the
 * candidate's CV, extracts text, parses structured signals, scores against the job's
 * criteria, and writes the result back onto the job_applications row. Because jobs live
 * in the DB they survive restarts and can be processed by multiple workers safely
 * (SELECT ... FOR UPDATE SKIP LOCKED).
 *
 * Lifecycle: pending -> processing -> done | failed
 *   attempts / max_attempts : retry accounting
 *   scheduled_at            : earliest run time (drives exponential backoff)
 *   locked_at / locked_by   : claim markers so concurrent workers never double-process
 *
 * We queue by application_id (not the CV bytes): the worker resolves the current CV
 * attachment + job criteria at run time, so a re-enqueue always screens the latest data.
 */
module.exports = (sequelize) => {
  const ResumeScreeningJob = sequelize.define(
    'ResumeScreeningJob',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      uuid: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },

      // The application to screen. Denormalized org_id for tenant-safe housekeeping.
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'job_applications', key: 'id' },
      },
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      // Why this job was queued: 'apply' (new submission) or 'rescore' (criteria changed).
      reason: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'apply',
      },

      status: {
        type: DataTypes.ENUM,
        values: ['pending', 'processing', 'done', 'failed'],
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      max_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      scheduled_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      locked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      locked_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
    },
    {
      tableName: 'resume_screening_jobs',
      timestamps: true,
      underscored: true,
      indexes: [
        // The worker's hot query: find runnable pending jobs by schedule.
        { fields: ['status', 'scheduled_at'] },
        // Stale-lock recovery query: processing jobs whose lock has expired.
        { fields: ['status', 'locked_at'] },
        // De-dupe / lookup by application (e.g. avoid stacking duplicate pending jobs).
        { fields: ['application_id'] },
      ],
    }
  );

  return ResumeScreeningJob;
};
