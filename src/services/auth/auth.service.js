const httpStatus = require('http-status');
const moment = require('moment');
const crypto = require('crypto');
const { User, Organization } = require('../../models');
const ApiError = require('../../utils/ApiError');
const Encrypter = require('../../helper/encrypter');
const { buildAuthContext } = require('./auth-context.service');
const tokenService = require('./token.service');
const { tokenTypes } = require('../../config/tokens');
const { enqueueSafe } = require('../email/email.service');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/**
 * Authenticate a user by email/password and return { authContext, tokens, user }.
 *
 * Security behaviors:
 *  - Uniform error for "no such user" vs "wrong password" (no user enumeration).
 *  - Account lockout after repeated failures.
 *  - Only 'active' users may sign in.
 *  - Tokens embed role/org/permissions (resolved via buildAuthContext).
 */
const signIn = async (body, res) => {
  const { email, password } = body;
  const user = await User.findOne({
    where: { email },
    include: [{ model: Organization, as: 'organization', attributes: ['is_active'] }],
  });

  // Uniform failure to avoid revealing whether the email exists.
  const invalidCreds = () =>
    new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_credentials'));

  if (!user || !user.salt) {
    throw invalidCreds();
  }

  // Locked account?
  if (user.locked_until && moment(user.locked_until).isAfter(moment())) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('account_locked'));
  }

  // Invited but not yet activated?
  if (user.status === 'invited') {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('account_not_activated'));
  }
  // Disabled / any other non-active state?
  if (user.status !== 'active') {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('account_inactive'));
  }
  if (user.organization && !user.organization.is_active) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('organization_inactive'));
  }

  const hashed = await Encrypter.password_dec(password, user.salt);
  if (!constantTimeEquals(hashed, user.password)) {
    await registerFailedAttempt(user);
    throw invalidCreds();
  }

  // Success: reset counters, mark login.
  user.failed_login_attempts = 0;
  user.locked_until = null;
  user.is_login = true;
  await user.save();

  const authContext = await buildAuthContext(user.id);
  if (!authContext) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, res.__('something_went_wrong'));
  }

  const tokens = await tokenService.generateAuthTokens(authContext);
  return { authContext, tokens, user };
};

/** Timing-safe string comparison to avoid leaking match length via response time. */
const constantTimeEquals = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Increment failure counter and lock the account when the threshold is hit. */
const registerFailedAttempt = async (user) => {
  const attempts = (user.failed_login_attempts || 0) + 1;
  user.failed_login_attempts = attempts;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    user.locked_until = moment().add(LOCK_MINUTES, 'minutes').toDate();
    user.failed_login_attempts = 0;
  }
  await user.save();
};

/**
 * Exchange a valid refresh token for a fresh access+refresh pair (rotation).
 * Re-resolves the auth context from the DB so permission changes propagate.
 */
const refreshTokens = async (refreshToken, res) => {
  if (!refreshToken) {
    throw new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_token'));
  }
  let payload;
  try {
    ({ payload } = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH));
  } catch {
    throw new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_token'));
  }

  const authContext = await buildAuthContext(payload.sub);
  if (!authContext) {
    throw new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_token'));
  }

  // Rotate: revoke the used refresh token, issue a new pair.
  await tokenService.revokeToken(refreshToken);
  const tokens = await tokenService.generateAuthTokens(authContext);
  return { authContext, tokens };
};

/** Invalidate the given refresh token. */
const logout = async (refreshToken) => {
  if (refreshToken) {
    await tokenService.revokeToken(refreshToken);
  }
};

/**
 * Request a password reset.
 *
 * Privacy: ALWAYS resolves successfully whether or not the email exists, so an
 * attacker can't use this endpoint to discover which emails are registered.
 * If the user exists and is active, a reset email is enqueued (fire-and-forget).
 */
const requestPasswordReset = async (email) => {
  const user = await User.findOne({ where: { email } });
  if (user && user.status === 'active') {
    const { token } = await tokenService.generateResetPasswordToken(user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;
    enqueueSafe('password_reset', user.email, {
      firstName: user.first_name,
      resetUrl,
      expiresInMinutes: Number(process.env.JWT_RESET_PASSWORD_EXPIRATION_MINUTES || 10),
    });
  }
  // Uniform response regardless of existence.
  return true;
};

/**
 * Complete a password reset using a valid reset token + new password.
 * The token is one-time: it's revoked after a successful reset.
 */
const resetPassword = async (token, newPassword, res) => {
  let payload;
  let tokenDoc;
  try {
    ({ payload, tokenDoc } = await tokenService.verifyToken(token, tokenTypes.RESET_PASSWORD));
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }

  const user = await User.findByPk(payload.sub);
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }

  const enc = await Encrypter.password_enc(newPassword);
  user.password = enc.encr;
  user.salt = enc.salt;
  // Reset security counters on password change.
  user.failed_login_attempts = 0;
  user.locked_until = null;
  // Bump token_version: instantly invalidates all existing ACCESS tokens.
  user.token_version = (user.token_version || 0) + 1;
  await user.save();

  // Invalidate every existing session:
  //  - one-time reset token,
  //  - all refresh tokens (so an attacker's session cannot be refreshed after reset).
  await tokenService.revokeToken(tokenDoc.token);
  await tokenService.revokeAllUserTokens(user.id);
  return true;
};

/**
 * Validate an activation (invite) token WITHOUT consuming it. Used by the frontend
 * to decide whether to render the set-password form or a friendly error.
 * Returns minimal, safe info; never reveals whether an email exists beyond the token.
 */
const verifyActivationToken = async (token, res) => {
  let payload;
  try {
    ({ payload } = await tokenService.verifyToken(token, tokenTypes.INVITE));
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }
  // Single indexed PK lookup — scales fine at millions of users.
  const user = await User.findByPk(payload.sub, {
    attributes: ['id', 'email', 'first_name', 'status'],
  });
  if (!user || user.status !== 'invited') {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }
  return { email: user.email, firstName: user.first_name };
};

/**
 * Activate an invited account: set the chosen password, flip status to 'active',
 * consume the invite token (one-time), and revoke any other outstanding tokens.
 */
const activateAccount = async (token, newPassword, res) => {
  let payload;
  let tokenDoc;
  try {
    ({ payload, tokenDoc } = await tokenService.verifyToken(token, tokenTypes.INVITE));
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }

  const user = await User.findByPk(payload.sub);
  if (!user || user.status !== 'invited') {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('invalid_token'));
  }

  const enc = await Encrypter.password_enc(newPassword);
  user.password = enc.encr;
  user.salt = enc.salt;
  user.status = 'active';
  user.failed_login_attempts = 0;
  user.locked_until = null;
  await user.save();

  // Consume this invite token and clear any other invite tokens for the user.
  await tokenService.revokeToken(tokenDoc.token);
  await tokenService.revokeAllUserTokens(user.id, tokenTypes.INVITE);
  return true;
};

/** Load the safe profile fields for the authenticated user (used by /auth/me). */
const getProfile = async (userId) => {
  return User.findByPk(userId, {
    attributes: ['id', 'uuid', 'first_name', 'last_name', 'email', 'organization_id'],
  });
};

module.exports = {
  signIn,
  refreshTokens,
  logout,
  requestPasswordReset,
  resetPassword,
  verifyActivationToken,
  activateAccount,
  getProfile,
};
