const { EmailJob } = require('../../models');
const { render, isValidTemplate } = require('./templates');
const logger = require('../../config/logger');

/**
 * Public email API used by the rest of the app.
 *
 * enqueue() renders the template NOW (fast, in-memory) and persists a 'pending'
 * EmailJob, then returns immediately. The background worker does the actual send.
 * This is what lets API endpoints respond without waiting on email delivery.
 *
 * Callers should treat this as fire-and-forget: never `await` it inside a request
 * path in a way that blocks the response, and swallow errors so a queue hiccup can
 * never break the primary action (see enqueueSafe()).
 */
const enqueue = async (templateKey, toEmail, data = {}, options = {}) => {
  if (!isValidTemplate(templateKey)) {
    throw new Error(`Unknown email template: ${templateKey}`);
  }

  const { subject, html, text } = render(templateKey, data);

  const job = await EmailJob.create({
    template: templateKey,
    to_email: toEmail,
    subject,
    html_body: html,
    text_body: text,
    payload: data,
    status: 'pending',
    max_attempts: options.maxAttempts || Number(process.env.EMAIL_MAX_ATTEMPTS || 3),
    scheduled_at: options.scheduledAt || new Date(),
  });

  return job;
};

/**
 * Fire-and-forget wrapper: enqueue without ever throwing into the caller.
 * Use this from request handlers so email problems can't affect the API response.
 */
const enqueueSafe = (templateKey, toEmail, data = {}, options = {}) => {
  Promise.resolve()
    .then(() => enqueue(templateKey, toEmail, data, options))
    .catch((err) => logger.error(`[email] enqueue failed for "${templateKey}" -> ${toEmail}: ${err.message}`));
};

module.exports = { enqueue, enqueueSafe };
