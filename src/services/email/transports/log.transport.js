const fs = require('fs');
const path = require('path');
const logger = require('../../../config/logger');

/**
 * Log transport — the default when no SMTP credentials are configured.
 *
 * "Sends" an email by logging it and writing the rendered message to
 * logs/emails/<timestamp>-<to>.html, so you can preview templates during
 * development with zero credentials. Always succeeds.
 */
const OUTPUT_DIR = path.resolve(process.cwd(), 'logs', 'emails');

const send = async ({ to, subject, html, text }) => {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const safeTo = to.replace(/[^a-z0-9@._-]/gi, '_');
    const file = path.join(OUTPUT_DIR, `${Date.now()}-${safeTo}.html`);
    fs.writeFileSync(file, html || text || '');
    logger.info(`[email:log] "${subject}" -> ${to} (preview: ${file})`);
    return { accepted: [to], transport: 'log', preview: file };
  } catch (err) {
    // Even the log transport failing shouldn't crash the worker; surface as error.
    throw new Error(`log transport failed: ${err.message}`);
  }
};

/** No pooled resources to release. */
const close = async () => {};

module.exports = { send, close, name: 'log' };
