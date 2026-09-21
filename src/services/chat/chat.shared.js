const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');

/**
 * Shared chat helpers: the SINGLE place that owns tenant isolation + participancy
 * rules for messaging. Every conversation/message service call routes its scope
 * decisions through here so the org boundary can never drift.
 *
 * Rules recap:
 *   - super_admin may message anyone in any org (cross-org threads are flagged).
 *   - everyone else may only see/search/message users in THEIR OWN organization.
 *   - a conversation is visible only to its participants.
 */

/** Assert the request passed through tenantScope (fail-closed, like the other modules). */
const assertTenantScoped = (req) => {
  if (!req.auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (req.tenantScoped !== true || req.tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }
};

/**
 * Compute the deterministic dedupe key for a direct conversation, namespaced by scope
 * so an intra-org DM and a cross-org DM between the same ids can never collide.
 *   intra-org: dm:org:<orgId>:<minId>:<maxId>
 *   cross-org: dm:x:<minId>:<maxId>
 */
const buildDmKey = ({ organizationId, isCrossOrg, userA, userB }) => {
  const [min, max] = userA < userB ? [userA, userB] : [userB, userA];
  if (isCrossOrg || organizationId == null) {
    return `dm:x:${min}:${max}`;
  }
  return `dm:org:${organizationId}:${min}:${max}`;
};

/**
 * Decide whether `sender` (from req.auth) is allowed to message `recipient` (a User
 * row), and return the resolved conversation scope.
 *
 * Throws 404 (not 403) on a cross-org attempt by a non-super user, so we never leak
 * that a user in another organization exists.
 *
 * Returns: { organizationId, isCrossOrg }
 *   - super_admin -> recipient's org (or cross-org when recipient has a different/own org)
 *   - org user    -> must match caller's org exactly
 */
const resolveDirectScope = (auth, recipient, res) => {
  const notFound = () =>
    new ApiError(httpStatus.NOT_FOUND, res ? res.__('user_not_found') : 'User not found');

  if (!recipient || recipient.status !== 'active') {
    throw notFound();
  }

  // A user cannot start a conversation with themselves.
  if (recipient.id === auth.userId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      res ? res.__('something_went_wrong') : 'Cannot message yourself'
    );
  }

  if (auth.isSuperAdmin) {
    // Super admin: intra-org if the recipient has an org, else platform-level.
    const organizationId = recipient.organization_id ?? null;
    // A super admin has no org of their own, so any thread they start is cross-org
    // from the org user's perspective -> flagged as platform admin.
    return { organizationId, isCrossOrg: true };
  }

  // Regular user: hard org-boundary check.
  if (
    recipient.organization_id == null ||
    recipient.organization_id !== auth.organizationId
  ) {
    throw notFound();
  }
  return { organizationId: auth.organizationId, isCrossOrg: false };
};

module.exports = {
  assertTenantScoped,
  buildDmKey,
  resolveDirectScope,
};
