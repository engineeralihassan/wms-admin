const nodemailer = require('nodemailer');
const logger = require('../../../config/logger');

/**
 * SMTP transport — used when EMAIL_TRANSPORT=smtp and SMTP_* env vars are set.
 * Works with any SMTP provider (SendGrid, SES, Mailgun, Gmail, ...).
 *
 * The transporter is created lazily and reused (connection pooling) so we don't
 * rebuild it per email — important for throughput.
 */
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 5),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
  });
  return transporter;
};

const send = async ({ to, subject, html, text }) => {
  const from = process.env.EMAIL_FROM || 'WMS Admin <no-reply@wms.local>';
  const info = await getTransporter().sendMail({ from, to, subject, html, text });
  logger.info(`[email:smtp] "${subject}" -> ${to} (id: ${info.messageId})`);
  return { accepted: info.accepted, transport: 'smtp', messageId: info.messageId };
};

/** Close the pooled connections on graceful shutdown. */
const close = async () => {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
};

module.exports = { send, close, name: 'smtp' };
