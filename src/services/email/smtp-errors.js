/**
 * Classifies email send failures into permanent vs transient, so the worker doesn't
 * waste retries on errors that will never succeed (e.g. an invalid mailbox), while
 * still retrying temporary problems (greylisting, rate limits, connection blips).
 *
 * SMTP reply codes:
 *   4xx  -> transient (retry): 421 service unavailable, 450/451 mailbox busy, 452 storage
 *   429  -> transient (rate limited by provider)  -> retry with backoff
 *   5xx  -> mostly permanent, EXCEPT a few providers use 5xx for temporary throttling.
 *           We treat classic "no such mailbox / rejected" 5xx as permanent.
 *
 * Nodemailer surfaces the code on err.responseCode (and sometimes err.code for
 * connection errors like ECONNREFUSED/ETIMEDOUT, which are transient).
 */

// Connection-level errors are transient — the provider was simply unreachable.
const TRANSIENT_CONN_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ETLS',
]);

// SMTP reply codes we consider permanent (don't retry).
const PERMANENT_SMTP_CODES = new Set([
  550, // mailbox unavailable / rejected
  551, // user not local
  553, // mailbox name not allowed
  554, // transaction failed / message rejected
]);

/**
 * @param {Error} err  the error thrown by the transport's send()
 * @returns {boolean}  true if the failure is permanent and should NOT be retried
 */
const isPermanentFailure = (err) => {
  if (!err) return false;

  // Connection errors -> transient.
  if (err.code && TRANSIENT_CONN_CODES.has(err.code)) return false;

  const code = Number(err.responseCode);
  if (Number.isNaN(code)) {
    // Unknown/non-SMTP error: treat as transient so it gets retried.
    return false;
  }

  if (code === 429) return false; // rate limited -> retry
  if (code >= 400 && code < 500) return false; // 4xx -> transient
  if (PERMANENT_SMTP_CODES.has(code)) return true; // known permanent 5xx

  // Other 5xx: default to permanent (don't hammer the provider), but this is the
  // one place to relax if a specific provider uses 5xx for throttling.
  return code >= 500;
};

module.exports = { isPermanentFailure };
