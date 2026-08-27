const os = require('os');
const { Op } = require('sequelize');
const { EmailJob, sequelize } = require('../../models');
const { getTransport } = require('./transport');
const { isPermanentFailure } = require('./smtp-errors');
const logger = require('../../config/logger');

/**
 * Background email worker (Level-2 queue processor).
 *
 * Design:
 *  - DRAIN LOOP: continuously claim + process batches; only sleep POLL_INTERVAL_MS
 *    when the queue is empty. A large backlog is drained as fast as the limits allow,
 *    not one slow batch every few seconds.
 *  - CONTROLLED CONCURRENCY: each claimed batch is sent in parallel chunks of
 *    EMAIL_CONCURRENCY, so the SMTP connection pool is actually used (instead of one
 *    message at a time). Concurrency is capped to respect provider limits.
 *  - SAFE CLAIMING: SELECT ... FOR UPDATE SKIP LOCKED lets multiple workers/instances
 *    claim disjoint job sets without double-sending.
 *  - RETRY CLASSIFICATION: transient failures back off and retry; permanent failures
 *    (e.g. invalid mailbox) fail immediately without wasting retries.
 *  - GRACEFUL SHUTDOWN: stops claiming new work, lets in-flight sends finish, closes
 *    the SMTP pool.
 *
 * Durable and Redis-free. The same enqueue interface can later move to BullMQ/Redis
 * for very high throughput without changing callers.
 */
const WORKER_ID = `${os.hostname()}#${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS || 5000);
const BATCH_SIZE = Number(process.env.EMAIL_BATCH_SIZE || 100);
const CONCURRENCY = Math.max(1, Number(process.env.EMAIL_CONCURRENCY || 10));
const STALE_LOCK_MS = Number(process.env.EMAIL_STALE_LOCK_MS || 2 * 60 * 1000);

let running = false; // is the drain loop active
let stopping = false; // shutdown requested
let loopPromise = null; // resolves when the loop fully exits

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: 1st retry ~1min, 2nd ~4min, 3rd ~9min (attempt^2 minutes). */
const backoffMs = (attempt) => attempt * attempt * 60 * 1000;

/**
 * Atomically claim a batch of runnable jobs. Runnable = pending and due, OR left
 * 'processing' by a crashed worker beyond the stale window (self-healing).
 */
const claimJobs = async () => {
  return sequelize.transaction(async (transaction) => {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_LOCK_MS);

    const jobs = await EmailJob.findAll({
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
    await EmailJob.update(
      { status: 'processing', locked_at: now, locked_by: WORKER_ID },
      { where: { id: { [Op.in]: ids } }, transaction }
    );
    return jobs;
  });
};

/** Send a single claimed job, handling success/retry/permanent-failure transitions. */
const processJob = async (job) => {
  const transport = getTransport();
  const attempt = job.attempts + 1;
  try {
    await transport.send({
      to: job.to_email,
      subject: job.subject,
      html: job.html_body,
      text: job.text_body,
    });
    await job.update({
      status: 'sent',
      attempts: attempt,
      sent_at: new Date(),
      last_error: null,
      locked_at: null,
      locked_by: null,
    });
    return 'sent';
  } catch (err) {
    // Permanent failures (bad address, rejected content) should not be retried.
    const permanent = isPermanentFailure(err);
    const exhausted = permanent || attempt >= job.max_attempts;
    await job.update({
      status: exhausted ? 'failed' : 'pending',
      attempts: attempt,
      last_error: err.message,
      scheduled_at: exhausted ? job.scheduled_at : new Date(Date.now() + backoffMs(attempt)),
      locked_at: null,
      locked_by: null,
    });
    logger.warn(
      `[email:worker] job ${job.id} attempt ${attempt} failed: ${err.message}` +
        (exhausted ? (permanent ? ' (permanent, giving up)' : ' (giving up)') : ' (will retry)')
    );
    return 'failed';
  }
};

/**
 * Process a claimed batch in parallel chunks of CONCURRENCY, so the SMTP pool is
 * saturated up to the configured limit rather than sending one message at a time.
 * Returns { sent, failed }.
 */
const processBatch = async (jobs) => {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const chunk = jobs.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(chunk.map((job) => processJob(job)));
    for (const r of results) {
      if (r === 'sent') sent += 1;
      else failed += 1;
    }
    if (stopping) break; // stop starting new chunks once shutdown is requested
  }
  return { sent, failed };
};

/**
 * The drain loop: keep claiming and sending until the queue is empty, then sleep.
 * Runs until stop() is called.
 */
const runLoop = async () => {
  running = true;
  logger.info(
    `[email:worker] started (${WORKER_ID}) batch=${BATCH_SIZE} concurrency=${CONCURRENCY}`
  );
  while (!stopping) {
    try {
      const startedAt = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const jobs = await claimJobs();

      if (jobs.length === 0) {
        // Queue empty — idle until the next poll.
        // eslint-disable-next-line no-await-in-loop
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const { sent, failed } = await processBatch(jobs);
      const durationMs = Date.now() - startedAt;
      const throughput = durationMs > 0 ? ((sent + failed) / (durationMs / 1000)).toFixed(1) : '∞';
      logger.info(
        `[email:worker] batch=${jobs.length} sent=${sent} failed=${failed} ` +
          `duration=${durationMs}ms throughput=${throughput}/s`
      );
    } catch (err) {
      logger.error(`[email:worker] loop error: ${err.message}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(POLL_INTERVAL_MS); // avoid a hot error loop
    }
  }
  running = false;
  logger.info('[email:worker] loop exited');
};

/** Start the drain loop. Idempotent. */
const start = () => {
  if (running) return;
  stopping = false;
  loopPromise = runLoop();
};

/**
 * Graceful shutdown: stop claiming new work, wait for the loop to exit (in-flight
 * sends finish), then close the SMTP pool. Safe to await from a SIGTERM handler.
 */
const stop = async () => {
  stopping = true;
  if (loopPromise) {
    await loopPromise;
    loopPromise = null;
  }
  const transport = getTransport();
  if (typeof transport.close === 'function') {
    await transport.close();
  }
};

module.exports = { start, stop, runLoop };
