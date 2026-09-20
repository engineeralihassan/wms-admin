const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { authService, userService, userDocumentService } = require('../../services');
const fileService = require('../../services/storage/file.service');
const { UPLOAD_FOLDERS } = require('../../config/storage');
const { toDto: userToDto, documentToDto } = require('../user/user.controller');

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
 * GET /auth/activate/verify?token=...
 * Validates an invite token so the SPA can render the set-password form or an error.
 */
const verifyActivation = catchAsync(async (req, res) => {
  const data = await authService.verifyActivationToken(req.query.token, res);
  res.status(httpStatus.OK).send({ message: res.__('token_valid'), data });
});

/**
 * POST /auth/activate  { token, password }
 * Sets the password and activates the account (one-time).
 */
const activate = catchAsync(async (req, res) => {
  await authService.activateAccount(req.body.token, req.body.password, res);
  res.status(httpStatus.OK).send({ message: res.__('account_activated'), data: null });
});

/**
 * POST /auth/me/password  (protected)
 * Body: { current_password, new_password }
 * Self-service password change for the logged-in user. Requires the current password;
 * on success all of the user's other sessions are invalidated.
 */
const changePassword = catchAsync(async (req, res) => {
  await authService.changePassword(
    req.auth.userId,
    req.body.current_password,
    req.body.new_password,
    res
  );
  clearRefreshCookie(res);
  res.status(httpStatus.OK).send({ message: res.__('password_changed'), data: null });
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

/**
 * GET /auth/me/profile  (protected)
 * The caller's OWN full profile (Work / Private / Contract / Settings + documents).
 * This is how a consultant reviews their profile after activating their account.
 */
const getMyProfile = catchAsync(async (req, res) => {
  const user = await userService.getOwnProfile(req.auth.userId);
  res.status(httpStatus.OK).send({ message: res.__('userFound'), data: userToDto(user) });
});

/**
 * PATCH /auth/me/profile  (protected)
 * The caller fills in / updates their OWN profile. Partial: only provided tabs/keys
 * are written. This is the consultant-side data-entry path.
 */
const updateMyProfile = catchAsync(async (req, res) => {
  const user = await userService.updateOwnProfile(req.auth.userId, req.body, res);
  res.status(httpStatus.OK).send({ message: res.__('userUpdated'), data: userToDto(user) });
});

/** GET /auth/me/documents  (protected) — the caller's own document checklist. */
const getMyDocuments = catchAsync(async (req, res) => {
  const docs = await userDocumentService.listOwnDocuments(req.auth.userId);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: docs });
});

/**
 * POST /auth/me/documents  (protected) — the caller uploads/records a document for
 * their OWN profile. Accepts a multipart `file` part (pushed to object storage here)
 * or pre-uploaded JSON metadata. A verified (locked) slot is rejected server-side.
 */
const uploadMyDocument = catchAsync(async (req, res) => {
  const payload = { ...req.body };

  if (req.file) {
    const [descriptor] = await fileService.uploadMany(
      [{ ...req.file, field: req.file.fieldname }],
      { folder: UPLOAD_FOLDERS.USER_DOCUMENTS }
    );
    payload.storage_key = descriptor.key;
    payload.file_url = descriptor.url;
    payload.file_name = payload.file_name || descriptor.name;
    payload.file_mime = payload.file_mime || descriptor.mime;
    payload.file_size = payload.file_size != null ? payload.file_size : descriptor.size;
  }

  const doc = await userDocumentService.uploadOwnDocument(
    req.auth.userId,
    req.auth.organizationId,
    payload,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('success'), data: documentToDto(doc) });
});

module.exports = {
  signIn,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyActivation,
  activate,
  changePassword,
  getMe,
  getMyProfile,
  updateMyProfile,
  getMyDocuments,
  uploadMyDocument,
};
