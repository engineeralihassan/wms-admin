const { Op } = require('sequelize');
const moment = require('moment');
const { Message, sequelize } = require('../../models');
const logger = require('../../config/logger');

/**
 * Chat retention worker — a lightweight periodic sweep that SOFT-deletes messages older
 * than the configured window (default 6 months). Follows the same start/stop lifecycle
 * as the email/timesheet workers so server.js wires it identically.
 *
 * Soft delete (deleted_at) rather than hard delete preserves moderation/audit and lets
 * an accidental over-aggressive setting be recovered. A future hard-purge pass can drop
 * rows that have been soft-deleted for a long time if storage becomes a concern.
 *
 * The sweep is batched (BATCH_SIZE per statement) so a large backlog never locks the
 * table in one huge UPDATE; it loops until nothing older remains, then idles until the
 * next interval. Gated behind CHAT_CLEANUP_ENABLED.
 */
const bool = (v, def) => (v === undefined ? def : String(v).toLowerCase() === 'true');
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

const ENABLED = bool(process.env.CHAT_CLEANUP_ENABLED, true);
const RETENTION_MONTHS = num(process.env.CHAT_RETENTION_MONTHS, 6);
const INTERVAL_MS = num(process.env.CHAT_CLEANUP_INTERVAL_MS, 24 * 60 * 60 * 1000); // 24h
const BATCH_SIZE = num(process.env.CHAT_CLEANUP_BATCH_SIZE, 500);

let timer = null;
let sweeping = false;

/**
 * One retention sweep: soft-delete messages created before the cutoff, in batches,
 * until none remain. Returns the total number of messages soft-deleted.
 */
const runSweep = async () => {
  const cutoff = moment().subtract(RETENTION_MONTHS, 'months').toDate();
  let totalDeleted = 0;

  // Loop batch-by-batch so a huge backlog doesn't lock the table in one statement.
  // Each pass selects a bounded set of old, not-yet-deleted message ids and stamps them.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Message.findAll({
      where: { created_at: { [Op.lt]: cutoff }, deleted_at: { [Op.is]: null } },
      attributes: ['id'],
      limit: BATCH_SIZE,
      order: [['id', 'ASC']],
    });
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    // eslint-disable-next-line no-await-in-loop
    const [count] = await Message.update(
      { deleted_at: new Date() },
      { where: { id: { [Op.in]: ids } } }
    );
    totalDeleted += count;

    if (rows.length < BATCH_SIZE) break; // last (partial) batch processed
  }

  return totalDeleted;
};

/** Run a sweep now, guarding against overlap. */
const sweepOnce = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const deleted = await runSweep();
    if (deleted > 0) {
      logger.info(`[chat:retention] soft-deleted ${deleted} message(s) older than ${RETENTION_MONTHS} months`);
    }
  } catch (err) {
    logger.error(`[chat:retention] sweep error: ${err.message}`);
  } finally {
    sweeping = false;
  }
};

/** Start the periodic sweep. No-op when disabled. Idempotent. */
const start = () => {
  if (timer) return;
  if (!ENABLED) {
    logger.info('[chat:retention] disabled (CHAT_CLEANUP_ENABLED=false)');
    return;
  }
  // Kick one sweep shortly after boot, then on the configured interval. unref() so the
  // timer never keeps the process alive on its own.
  setTimeout(sweepOnce, 10 * 1000).unref?.();
  timer = setInterval(sweepOnce, INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info(`[chat:retention] started — every ${INTERVAL_MS}ms, retention=${RETENTION_MONTHS} months`);
};

/** Stop the periodic sweep (graceful shutdown). */
const stop = async () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = { start, stop, runSweep, sweepOnce };
