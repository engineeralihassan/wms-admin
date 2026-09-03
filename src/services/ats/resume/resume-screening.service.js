/**
 * resume-screening.service — the enqueue side of the async screening queue.
 *
 * Mirrors email.service (enqueue / enqueueSafe): callers persist a 'pending'
 * ResumeScreeningJob row and return immediately; the resume worker picks it up later,
 * calls Rezmatch, and writes the score back onto the application. Enqueuing is
 * fire-and-forget from the request path — a queue hiccup must never break the primary
 * action (submitting an application, saving a job).
 *
 * De-dupe: if an application already has a runnable (pending/processing) job, we don't
 * stack another — we just leave the existing one (or bump it forward for a rescore).
 */

const { Op } = require('sequelize');
const { ResumeScreeningJob } = require('../../../models');
const { config } = require('../../../config/ai');
const logger = require('../../../config/logger');

/**
 * Enqueue a screening job for one application.
 * @param {number} applicationId
 * @param {{ organizationId?: number, reason?: 'apply'|'rescore', transaction?: object }} opts
 * @returns {Promise<object|null>} the job row (or null when screening is disabled)
 */
const enqueue = async (applicationId, opts = {}) => {
  if (!config.enabled) return null; // screening off/unconfigured -> no-op

  const { organizationId = null, reason = 'apply', transaction } = opts;

  // Avoid piling up duplicate runnable jobs for the same application.
  const existing = await ResumeScreeningJob.findOne({
    where: { application_id: applicationId, status: { [Op.in]: ['pending', 'processing'] } },
    transaction,
  });
  if (existing) {
    // For a rescore, make sure it runs promptly (reset schedule if it was backed off).
    if (reason === 'rescore' && existing.status === 'pending') {
      await existing.update({ scheduled_at: new Date(), reason }, { transaction });
    }
    return existing;
  }

  return ResumeScreeningJob.create(
    {
      application_id: applicationId,
      organization_id: organizationId,
      reason,
      status: 'pending',
      max_attempts: config.worker.maxAttempts,
      scheduled_at: new Date(),
    },
    { transaction }
  );
};

/**
 * Fire-and-forget wrapper: enqueue without ever throwing into the caller. Use this
 * from request handlers (e.g. right after the apply transaction commits).
 */
const enqueueSafe = (applicationId, opts = {}) => {
  if (!config.enabled) return;
  Promise.resolve()
    .then(() => enqueue(applicationId, opts))
    .catch((err) =>
      logger.error(`[resume] enqueue failed for application ${applicationId}: ${err.message}`)
    );
};

module.exports = { enqueue, enqueueSafe };
