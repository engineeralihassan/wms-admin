const httpStatus = require('http-status');
const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { isTokenIncluded, getAccessTokenFromHeader } = require('../helper/auth');
const { tokenTypes } = require('../config/tokens');
const { User, Organization } = require('../models');

/**
 * authVerify — authenticates the request from the JWT access token.
 *
 * Authorization data (role, org, permissions) is read from the signed token claims,
 * so no join is needed to authorize. To support INSTANT session revocation, it does
 * one lightweight primary-key lookup to verify the token is still valid:
 *   - the token's `tv` (token_version) must match the user's current token_version
 *     (a mismatch means the session was revoked: password reset, role change, disable);
 *   - the user's status must still be 'active'.
 *
 * This is the deliberate, standard trade-off: one indexed PK read per request buys
 * immediate revocation, which a pure stateless token cannot provide.
 *
 * Attaches:
 *   req.auth = { userId, uuid, organizationId, role, isSuperAdmin, permissions, tokenVersion }
 *   req.user = { id, uuid }
 */
const authVerify = async (req, res, next) => {
  if (!isTokenIncluded(req)) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('token_missing')));
  }

  const accessToken = getAccessTokenFromHeader(req);
  let decoded;
  try {
    decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
  } catch {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_token')));
  }

  if (decoded.type !== tokenTypes.ACCESS) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('invalid_token')));
  }

  // Revocation check: minimal indexed read of just the fields we need.
  let user;
  try {
    user = await User.findByPk(decoded.sub, {
      attributes: ['id', 'token_version', 'status'],
      include: [{ model: Organization, as: 'organization', attributes: ['is_active'] }],
    });
  } catch (dbErr) {
    return next(dbErr);
  }

  if (
    !user ||
    user.status !== 'active' ||
    user.token_version !== (decoded.tv ?? 0) ||
    (user.organization && !user.organization.is_active)
  ) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('session_revoked')));
  }

  req.auth = {
    userId: decoded.sub,
    uuid: decoded.uuid,
    organizationId: decoded.org ?? null,
    role: decoded.role,
    isSuperAdmin: !!decoded.sa,
    permissions: decoded.perms || [],
    tokenVersion: decoded.tv ?? 0,
  };
  req.user = { id: decoded.sub, uuid: decoded.uuid };
  return next();
};

/**
 * requirePermission('user.create', ...) — allows the request only if the token
 * carries at least one of the given permissions. super_admin bypasses all checks.
 */
const requirePermission = (...required) => (req, res, next) => {
  if (!req.auth) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('unauthorized')));
  }
  if (req.auth.isSuperAdmin) {
    return next();
  }
  const granted = req.auth.permissions || [];
  const ok = required.some((perm) => granted.includes(perm));
  if (!ok) {
    return next(new ApiError(httpStatus.FORBIDDEN, res.__('forbidden')));
  }
  return next();
};

/**
 * requireRole('org_admin', ...) — allows only the listed roles. super_admin bypasses.
 * Prefer requirePermission; use this only when a check is genuinely role-based.
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.auth) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('unauthorized')));
  }
  if (req.auth.isSuperAdmin) {
    return next();
  }
  if (!roles.includes(req.auth.role)) {
    return next(new ApiError(httpStatus.FORBIDDEN, res.__('forbidden')));
  }
  return next();
};

/**
 * tenantScope — enforces multi-tenant isolation, FAIL-CLOSED.
 *
 * Attaches req.tenantWhere: a Sequelize `where` fragment that tenant-scoped services
 * MUST spread into every query so results are limited to the caller's organization.
 *   - Regular users: { organization_id: <their org> }
 *   - super_admin:   {} (unrestricted — sees all organizations)
 *
 * Fail-closed guarantees (so isolation is never silently skipped):
 *   - A non-super-admin without an organization is REJECTED (403).
 *   - It marks req.tenantScoped = true. The scope helper used by services throws if
 *     it's ever asked to build a query for a request that did NOT pass through here,
 *     so forgetting the middleware breaks loudly instead of leaking data.
 */
const tenantScope = (req, res, next) => {
  if (!req.auth) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, res.__('unauthorized')));
  }
  req.tenantScoped = true;
  if (req.auth.isSuperAdmin) {
    req.tenantWhere = {};
    return next();
  }
  if (!req.auth.organizationId) {
    return next(new ApiError(httpStatus.FORBIDDEN, res.__('forbidden')));
  }
  req.tenantWhere = { organization_id: req.auth.organizationId };
  return next();
};

module.exports = {
  authVerify,
  requirePermission,
  requireRole,
  tenantScope,
};
