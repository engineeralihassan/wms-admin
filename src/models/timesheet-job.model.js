const { DataTypes } = require('sequelize');
const { TIMESHEET_JOB_TYPES } = require('../utils/timesheet.constants');

/**
 * TimesheetJob = one durable unit of periodic timesheet work (a DB-backed queue).
 *
 * Mirrors EmailJob / ResumeScreeningJob: a scheduler enqueues a row and a background
 * worker later claims 'pending' jobs (SELECT ... FOR UPDATE SKIP LOCKED), runs the
 * corresponding pass, and updates status. Because jobs live in the DB they survive
 * restarts and can be processed safely by multiple workers.
 *
 * The `job_type` selects which periodic pass to run (mirrors ResumeScreeningJob.reason):
 *   generate — create the upcoming week's timesheets for every valid project member.
 *   remind   — queue reminder emails for still-unsubmitted sheets nearing/at due date.
 *   lock     — lock overdue unsubmitted sheets, notify the org's approvers, and open a
 *              ticket on the owner's behalf so the backfill request is tracked.
 *
 * These passes are org-wide sweeps rather than per-entity work, so organization_id is
 * nullable (a single 'generate' job processes all active organizations). Keeping them
 * as queue rows (instead of inline setInterval work) means they retry with backoff and
 * never run twice concurrently across workers.
 *
 * Lifecycle: pending -> processing -> done | failed
 */
module.exports = (sequelize) => {
  const TimesheetJob = sequelize.define(
    'TimesheetJob',
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

      // Which periodic pass this job runs.
      job_type: {
        type: DataTypes.ENUM(...Object.values(TIMESHEET_JOB_TYPES)),
        allowNull: false,
      },

      // Optional tenant scope. Null = process all active organizations in this pass.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
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
      // A small JSON summary of what the pass did (counts), for observability.
      result: {
        type: DataTypes.JSONB,
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
      tableName: 'timesheet_jobs',
      timestamps: true,
      underscored: true,
      indexes: [
        // The worker's hot query: find runnable pending jobs by schedule.
        { fields: ['status', 'scheduled_at'] },
        // Stale-lock recovery query: processing jobs whose lock has expired.
        { fields: ['status', 'locked_at'] },
        // De-dupe lookup: avoid stacking duplicate pending jobs of the same type.
        { fields: ['job_type', 'status'] },
      ],
    }
  );

  return TimesheetJob;
};
