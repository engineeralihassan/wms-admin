const { DataTypes } = require('sequelize');

/**
 * EmailJob = one durable unit of outbound email work (the Level-2 queue).
 *
 * The API enqueues a row and returns immediately; a background worker later picks
 * up 'pending' jobs, sends them, and updates status. Because jobs live in the DB,
 * they survive process restarts and can be processed by multiple workers later.
 *
 * Lifecycle: pending -> processing -> sent | failed
 *   attempts:   how many send tries so far
 *   max_attempts: retry ceiling (default 3)
 *   scheduled_at: earliest time this job may run (used for backoff)
 *   locked_at / locked_by: claim markers so concurrent workers don't double-send
 */
module.exports = (sequelize) => {
  const EmailJob = sequelize.define(
    'EmailJob',
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
      // Which template produced this email (for auditing/debugging).
      template: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      to_email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Rendered HTML + text bodies (rendered at enqueue time so the worker is dumb/fast).
      html_body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      text_body: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Original template data kept for troubleshooting / re-render if ever needed.
      payload: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM,
        values: ['pending', 'processing', 'sent', 'failed'],
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
      sent_at: {
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
      tableName: 'email_jobs',
      timestamps: true,
      underscored: true,
      indexes: [
        // The worker's hot query: find runnable pending jobs by schedule.
        { fields: ['status', 'scheduled_at'] },
        // Stale-lock recovery query: processing jobs whose lock has expired.
        { fields: ['status', 'locked_at'] },
      ],
    }
  );

  return EmailJob;
};
