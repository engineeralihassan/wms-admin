const jwt = require('jsonwebtoken');
const moment = require('moment');
const { Op } = require('sequelize');
const { Token } = require('../../models');
const { tokenTypes } = require('../../config/tokens');

/**
 * Sign a JWT.
 *
 * The access token embeds the FULL authorization context (role, organization_id,
 * permissions) so the API can authorize every request without a database lookup.
 * The refresh token stays minimal — it only identifies the user; the context is
 * re-resolved from the DB when refreshing, so permission changes take effect on refresh.
 *
 * @param {object} claims  identity + optional authorization claims
 * @param {moment.Moment} expires
 * @param {string} type
 * @param {string} [secret]
 */
const generateToken = (claims, expires, type, secret = process.env.JWT_SECRET) => {
  const payload = {
    sub: claims.userId,
    uuid: claims.uuid,
    type,
    iat: moment().unix(),
    exp: expires.unix(),
  };

  // Authorization claims (present on access tokens only).
  if (type === tokenTypes.ACCESS) {
    payload.role = claims.role;
    payload.org = claims.organizationId ?? null;
    payload.perms = claims.permissions || [];
    payload.sa = !!claims.isSuperAdmin;
    payload.tv = claims.tokenVersion ?? 0; // session-revocation version
  }

  return jwt.sign(payload, secret);
};

/** Persist a token (used for refresh tokens so they can be revoked). */
const saveToken = async (token, userId, expires, type, blacklisted = false) => {
  return Token.create({
    token,
    user_id: userId,
    expires: expires.toDate(),
    type,
    blacklisted,
  });
};

/**
 * Verify a persisted token (e.g. refresh) is valid and not blacklisted/expired.
 * Returns the token record or throws.
 */
const verifyToken = async (token, type) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const tokenDoc = await Token.findOne({
    where: {
      token,
      type,
      user_id: payload.sub,
      blacklisted: false,
      expires: { [Op.gt]: new Date() },
    },
  });
  if (!tokenDoc) {
    throw new Error('Token not found or expired');
  }
  return { tokenDoc, payload };
};

/** Revoke a refresh token (blacklist it) — used on logout / rotation. */
const revokeToken = async (token) => {
  await Token.update({ blacklisted: true }, { where: { token } });
};

/**
 * Revoke ALL refresh tokens for a user (blacklist them). Used on password change,
 * password reset, and forced logout so existing sessions can no longer be refreshed.
 */
const revokeAllUserTokens = async (userId, type = tokenTypes.REFRESH) => {
  await Token.update(
    { blacklisted: true },
    { where: { user_id: userId, type, blacklisted: false } }
  );
};

/**
 * Issue an access + refresh token pair for the given auth context.
 * @param {object} authContext  from buildAuthContext()
 */
const generateAuthTokens = async (authContext) => {
  const accessExpires = moment().add(
    Number(process.env.JWT_ACCESS_EXPIRATION_MINUTES || 30),
    'minutes'
  );
  const accessToken = generateToken(authContext, accessExpires, tokenTypes.ACCESS);

  const refreshExpires = moment().add(
    Number(process.env.JWT_REFRESH_EXPIRATION_DAYS || 7),
    'days'
  );
  const refreshToken = generateToken(authContext, refreshExpires, tokenTypes.REFRESH);
  await saveToken(refreshToken, authContext.userId, refreshExpires, tokenTypes.REFRESH);

  return {
    access: { token: accessToken, expires: accessExpires.toDate() },
    refresh: { token: refreshToken, expires: refreshExpires.toDate() },
  };
};

/**
 * Generate + persist a short-lived password reset token for a user.
 * Stored so it can be one-time (revoked after use) and expiry-checked.
 */
const generateResetPasswordToken = async (user) => {
  const expires = moment().add(
    Number(process.env.JWT_RESET_PASSWORD_EXPIRATION_MINUTES || 10),
    'minutes'
  );
  const token = generateToken(
    { userId: user.id, uuid: user.uuid },
    expires,
    tokenTypes.RESET_PASSWORD
  );
  await saveToken(token, user.id, expires, tokenTypes.RESET_PASSWORD);
  return { token, expires: expires.toDate() };
};

/**
 * Generate + persist a longer-lived account-activation (invite) token.
 * Longer expiry than a reset (default 7 days) since an invitee may not check
 * email immediately. One-time use — consumed when the password is set.
 */
const generateInviteToken = async (user) => {
  const expires = moment().add(Number(process.env.JWT_INVITE_EXPIRATION_DAYS || 7), 'days');
  const token = generateToken({ userId: user.id, uuid: user.uuid }, expires, tokenTypes.INVITE);
  await saveToken(token, user.id, expires, tokenTypes.INVITE);
  return { token, expires: expires.toDate() };
};

module.exports = {
  generateToken,
  saveToken,
  verifyToken,
  revokeToken,
  revokeAllUserTokens,
  generateAuthTokens,
  generateResetPasswordToken,
  generateInviteToken,
};
