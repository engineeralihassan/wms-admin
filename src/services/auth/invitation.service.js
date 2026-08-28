const crypto = require('crypto');
const Encrypter = require('../../helper/encrypter');
const tokenService = require('./token.service');
const { enqueueSafe } = require('../email/email.service');

/**
 * Shared invitation helpers, used when creating users who must set their own
 * password (everyone except the seeded super admin).
 *
 * Scale note: enqueueSafe writes ONE row to the durable email queue and returns
 * immediately; the background worker (concurrent, retrying) does the actual send.
 * So inviting many users never blocks the request that created them.
 */

/**
 * Produce an UNUSABLE password + salt for an invited user. The password is random
 * and never shared, so the account cannot be logged into until activation sets a
 * real one. (We never store a null/empty password.)
 */
const buildUnusablePassword = async () => {
  const random = crypto.randomBytes(32).toString('hex');
  return Encrypter.password_enc(random); // -> { salt, encr }
};

/**
 * Issue an activation (invite) token for a user and enqueue the activation email.
 * Fire-and-forget: safe to call inside request handlers.
 */
const sendActivation = async (user, organizationName) => {
  const { token } = await tokenService.generateInviteToken(user);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
  const activationUrl = `${frontendUrl}/auth/activate?token=${encodeURIComponent(token)}`;
  enqueueSafe('account_activation', user.email, {
    firstName: user.first_name,
    organizationName: organizationName || '',
    activationUrl,
    expiresInDays: Number(process.env.JWT_INVITE_EXPIRATION_DAYS || 7),
  });
};

module.exports = { buildUnusablePassword, sendActivation };
