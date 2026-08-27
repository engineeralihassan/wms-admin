const logTransport = require('./transports/log.transport');
const smtpTransport = require('./transports/smtp.transport');
const logger = require('../../config/logger');

/**
 * Selects the active email transport based on env, with a safe fallback.
 *
 *   EMAIL_TRANSPORT=smtp  + SMTP_HOST/USER/PASSWORD set  -> real SMTP sending
 *   otherwise                                            -> log transport (dev)
 *
 * The rest of the system depends only on `getTransport().send(...)`, so switching
 * providers later is a config change, never a code change.
 */
const getTransport = () => {
  const choice = (process.env.EMAIL_TRANSPORT || 'log').toLowerCase();

  if (choice === 'smtp') {
    const configured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD;
    if (configured) {
      return smtpTransport;
    }
    logger.warn('[email] EMAIL_TRANSPORT=smtp but SMTP_* not fully set; falling back to log transport.');
  }
  return logTransport;
};

module.exports = { getTransport };
