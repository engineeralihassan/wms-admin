const os = require('os');
const { Op } = require('sequelize');
const { TimesheetJob, sequelize } = require('../../models');
const { TIMESHEET_JOB_TYPES } = require('../../utils/timesheet.constants');
const generator = require('./timesheet-generator.service');
const logger = require('../../config/logger');

/**
 * Timesheet background worker — the durable-queue pattern used by the email/resume
 * workers (SELECT ... FOR UPDATE SKIP LOCKED claim, drain loop, exponential backoff,
 * stale-lock self-healing), plus a lightweight SCHEDULER that enqueues the three
 * periodic passes so they run on a cadence without an external cron/Bull.
 *
 * Two moving parts:
 *   scheduler — on an interval, ensures there is a pending job of each type due now
 *               (de-duped so restarts don't stack duplicates). Cheap: a couple of
 *               indexed reads + at most a few inserts per tick.
 *   drain loop — claims pending jobs atomically and runs the matching generator pass.
 *
 * Because jobs are DB rows, this is safe to run as multiple instances (claims are
 * atomic) and survives restarts. Everything is gated behind TIMESHEET_WORKER_ENABLED so
 * it can be turned off (e.g. in tests or on a web-only dyno).
 */
const WORKER_ID = `${os.hostname()}#${process.pid}`;

const bool = (v, def) => (v === undefined ? def : String(v).toLowerCase() === 'true');
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

const ENABLED = bool(process.env.TIMESHEET_WORKER_ENABLED, true);
const POLL_INTERVAL_MS = num(process.env.TIMESHEET_POLL_INTERVAL_MS, 60 * 1000); // 1 min
// The scheduler enqueues the periodic passes once a day by default. Generation itself
// is still once-per-week-per-member (idempotent) — this only controls how often we
// re-check so a newly-added member or a missed week is caught. A daily tick keeps
// overhead negligible while guaranteeing no member is left without a timesheet.
const SCHEDULE_INTERVAL_MS = num(process.env.TIMESHEET_SCHEDULE_INTERVAL_MS, 24 * 60 * 60 * 1000); // 24h
const BATCH_SIZE = num(process.env.TIMESHEET_BATCH_SIZE, 5);
const STALE_LOCK_MS = num(process.env.TIMESHEET_STALE_LOCK_MS, 10 * 60 * 1000); // 10 min

let running = false;
let stopping = false;
let loopPromise = null;
let scheduleTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: attempt^2 minutes (mirrors the email/resume workers). */
const backoffMs = (attempt) => attempt * attempt * 60 * 1000;

// ── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Ensure a pending job of `type` exists, creating one if none is currently queued or
 * processing. This de-dupes so the hourly tick (and process restarts) never stack
 * duplicate passes — a single pending job is enough; the worker will run it promptly.
 */
const ensureJob = async (type) => {
  const existing = await TimesheetJob.findOne({
    where: { job_type: type, status: { [Op.in]: ['pending', 'processing'] } },
    attributes: ['id'],
  });
  if (existing) return false;
  await TimesheetJob.create({ job_type: type, status: 'pending', scheduled_at: new Date() });
  return true;
};

/**
 * One scheduler tick: make sure each periodic pass has a job queued. We keep this
 * simple and idempotent — the passes themselves are idempotent, so enqueueing "often"
 * is harmless and self-correcting (e.g. generate only creates the current week once).
 */
const scheduleTick = async () => {
  try {
    const created = [];
    for (const type of Object.values(TIMESHEET_JOB_TYPES)) {
      // eslint-disable-next-line no-await-in-loop
      if (await ensureJob(type)) created.push(type);
    }
    if (created.length) logger.info(`[timesheet:scheduler] enqueued ${created.join(', ')}`);
  } catch (err) {
    logger.error(`[timesheet:scheduler] tick error: ${err.message}`);
  }
};

// ── Drain loop ────────────────────────────────────────────────────────────────

/** Atomically claim a batch of runnable jobs (due-pending OR stale-processing). */
const claimJobs = async () => {
  return sequelize.transaction(async (transaction) => {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_LOCK_MS);

    const jobs = await TimesheetJob.findAll({
      where: {
        [Op.or]: [
          { status: 'pending', scheduled_at: { [Op.lte]: now } },
          { status: 'processing', locked_at: { [Op.lt]: staleThreshold } },
        ],
      },
      order: [['scheduled_at', 'ASC']],
      limit: BATCH_SIZE,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });
    if (jobs.length === 0) return [];

    const ids = jobs.map((j) => j.id);
    await TimesheetJob.update(
      { status: 'processing', locked_at: now, locked_by: WORKER_ID },
      { where: { id: ids }, transaction }
    );
    return jobs;
  });
};

/** Run the generator pass that matches a job's type. */
const runPass = (job) => {
  const scope = { organizationId: job.organization_id || undefined };
  switch (job.job_type) {
    case TIMESHEET_JOB_TYPES.GENERATE:
      return generator.runGenerate(scope);
    case TIMESHEET_JOB_TYPES.REMIND:
      return generator.runRemind(scope);
    case TIMESHEET_JOB_TYPES.LOCK:
      return generator.runLock(scope);
    default:
      throw new Error(`Unknown timesheet job type: ${job.job_type}`);
  }
};

/** Handle a failure with retry/backoff (mirrors the email/resume workers). */
const failJob = async (job, err) => {
  const attempt = job.attempts + 1;
  const exhausted = attempt >= job.max_attempts;
  await job.update({
    status: exhausted ? 'failed' : 'pending',
    attempts: attempt,
    last_error: err.message,
    scheduled_at: exhausted ? job.scheduled_at : new Date(Date.now() + backoffMs(attempt)),
    locked_at: null,
    locked_by: null,
    processed_at: exhausted ? new Date() : job.processed_at,
  });
  logger.warn(
    `[timesheet:worker] job ${job.id} (${job.job_type}) attempt ${attempt} failed: ${err.message}` +
      (exhausted ? ' (giving up)' : ' (will retry)')
  );
};

/** Process a single claimed job end-to-end. */
const processJob = async (job) => {
  const attempt = job.attempts + 1;
  try {
    const result = await runPass(job);
    await job.update({
      status: 'done',
      attempts: attempt,
      result: result || null,
      last_error: null,
      locked_at: null,
      locked_by: null,
      processed_at: new Date(),
    });
    return 'done';
  } catch (err) {
    await failJob(job, err);
    return 'failed';
  }
};

/** Process a claimed batch sequentially (these passes are DB-heavy sweeps). */
const processBatch = async (jobs) => {
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await processJob(job);
    if (r === 'failed') failed += 1;
    else done += 1;
    if (stopping) break;
  }
  return { done, failed };
};

/** The drain loop: claim + process until empty, then idle for POLL_INTERVAL_MS. */
const runLoop = async () => {
  running = true;
  logger.info(`[timesheet:worker] started (${WORKER_ID}) batch=${BATCH_SIZE}`);
  while (!stopping) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const jobs = await claimJobs();
      if (jobs.length === 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const { done, failed } = await processBatch(jobs);
      logger.info(`[timesheet:worker] batch=${jobs.length} done=${done} failed=${failed}`);
    } catch (err) {
      logger.error(`[timesheet:worker] loop error: ${err.message}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(POLL_INTERVAL_MS);
    }
  }
  running = false;
  logger.info('[timesheet:worker] loop exited');
};

/** Start the scheduler + drain loop. No-op when disabled. Idempotent. */
const start = () => {
  if (running) return;
  if (!ENABLED) {
    logger.info('[timesheet:worker] disabled (TIMESHEET_WORKER_ENABLED=false)');
    return;
  }
  stopping = false;
  // Kick a scheduler tick now, then on an interval. unref() so it never keeps the
  // process alive on its own.
  scheduleTick();
  scheduleTimer = setInterval(scheduleTick, SCHEDULE_INTERVAL_MS);
  if (scheduleTimer.unref) scheduleTimer.unref();
  loopPromise = runLoop();
};

/** Graceful shutdown: stop scheduling + claiming, let in-flight jobs finish. */
const stop = async () => {
  stopping = true;
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  if (loopPromise) {
    await loopPromise;
    loopPromise = null;
  }
};

module.exports = { start, stop, runLoop, scheduleTick };
