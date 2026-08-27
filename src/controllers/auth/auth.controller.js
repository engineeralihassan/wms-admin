const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { authService } = require('../../services');

const REFRESH_COOKIE = 'wms_refresh_token';

/**
 * Sets the refresh token as an httpOnly cookie so it is NOT reachable by JavaScript
 * (mitigates XSS token theft). Secure in production; SameSite=strict to blunt CSRF.
 * The access token stays in the response body (short-lived, held in memory by the SPA).
 */
const setRefreshCookie = (res, token, expires) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'PRODUCTION',
    sameSite: 'strict',
    expires: new Date(expires),
    path: '/api/v1/auth',
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
};

/** Read the refresh token from the httpOnly cookie, falling back to the body. */
const readRefreshToken = (req) => req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken || null;

/** Shape a user row into a safe, client-facing object (no password/salt). */
const sanitizeUser = (user, authContext) => ({
  id: user.id,
  uuid: user.uuid,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  organization_id: user.organization_id,
  role: authContext?.role,
  permissions: authContext?.permissions,
});

/**
 * POST /auth/signIn
 * Body: { email, password }
 * Returns the access token in the body; sets the refresh token as an httpOnly cookie.
 */
const signIn = catchAsync(async (req, res) => {
  const { authContext, tokens, user } = await authService.signIn(req.body, res);
  setRefreshCookie(res, tokens.refresh.token, tokens.refresh.expires);
  res.status(httpStatus.OK).send({
    message: res.__('userSignin'),
    data: {
      access: tokens.access,
      user: sanitizeUser(user, authContext),
    },
  });
});

/**
 * POST /auth/refresh
 * Refresh token comes from the httpOnly cookie (or body for non-browser clients).
 * Rotates the pair: new refresh cookie, new access token in the body.
 */
const refresh = catchAsync(async (req, res) => {
  const refreshToken = readRefreshToken(req);
  const { tokens } = await authService.refreshTokens(refreshToken, res);
  setRefreshCookie(res, tokens.refresh.token, tokens.refresh.expires);
  res.status(httpStatus.OK).send({
    message: res.__('token_refreshed'),
    data: { access: tokens.access },
  });
});

/**
 * POST /auth/logout — revokes the refresh token and clears the cookie.
 */
const logout = catchAsync(async (req, res) => {
  const refreshToken = readRefreshToken(req);
  await authService.logout(refreshToken);
  clearRefreshCookie(res);
  res.status(httpStatus.OK).send({ message: res.__('logout_success'), data: null });
});

/**
 * POST /auth/forgot-password
 * Body: { email }  — always returns success (no user enumeration).
 */
const forgotPassword = catchAsync(async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  res.status(httpStatus.OK).send({ message: res.__('reset_email_sent'), data: null });
});

/**
 * POST /auth/reset-password
 * Body: { token, password }
 */
const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password, res);
  clearRefreshCookie(res);
  res.status(httpStatus.OK).send({ message: res.__('password_reset_success'), data: null });
});

/**
 * GET /auth/me  (protected)
 * Returns the authenticated user + their resolved authorization context.
 */
const getMe = catchAsync(async (req, res) => {
  const profile = await authService.getProfile(req.auth.userId);
  res.status(httpStatus.OK).send({
    message: res.__('userFound'),
    data: {
      id: profile.id,
      uuid: profile.uuid,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      organization_id: req.auth.organizationId,
      role: req.auth.role,
      permissions: req.auth.permissions,
    },
  });
});

module.exports = {
  signIn,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
};
