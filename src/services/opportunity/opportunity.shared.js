/**
 * Shared helpers for the Opportunity discovery feature.
 *
 * Mirrors sales.shared.buildSalesScope: FAIL-CLOSED tenant + owner visibility. Requires
 * the request to have passed tenantScope (else 500). A rep sees only opportunities they
 * discovered (discovered_by_id = self); a manager / org admin (opportunity.delete, the
 * manage-level permission here) sees the whole org; super_admin spans orgs.
 */

const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const {
  OPPORTUNITY_TITLE_MAX,
  OPPORTUNITY_DESCRIPTION_MAX,
  OPPORTUNITY_SHORT_TEXT_MAX,
  OPPORTUNITY_URL_MAX,
} = require('../../utils/opportunity.constants');

/** True when the caller sees the WHOLE org's opportunities (manager/admin/super). */
const canSeeAllOpportunities = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.OPPORTUNITY_DELETE);

/**
 * Build the tenant + owner where-clause for opportunities.
 *   super_admin                       -> {}                                   (all orgs)
 *   holder of opportunity.delete      -> { organization_id }                  (whole org)
 *   everyone else                     -> { organization_id, discovered_by_id }(own only)
 */
const buildOpportunityScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }
  const scope = { ...tenantWhere };
  if (!canSeeAllOpportunities(auth)) {
    scope.discovered_by_id = auth.userId;
  }
  return scope;
};

// ── Sanitizers for UNTRUSTED external content ──────────────────────────────────
/** Coerce to a trimmed string capped at `max`, or null. Strips control chars. */
const cleanText = (value, max) => {
  if (value == null) return null;
  const s = String(value)
    // Drop ASCII control chars (keep normal whitespace) — never store raw control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
};

/** Keep only http(s) URLs (SSRF/again-untrusted guard), capped in length. */
const cleanUrl = (value) => {
  const s = cleanText(value, OPPORTUNITY_URL_MAX);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
};

const cleanTitle = (v) => cleanText(v, OPPORTUNITY_TITLE_MAX);
const cleanDescription = (v) => cleanText(v, OPPORTUNITY_DESCRIPTION_MAX);
const cleanShort = (v) => cleanText(v, OPPORTUNITY_SHORT_TEXT_MAX);

module.exports = {
  canSeeAllOpportunities,
  buildOpportunityScope,
  cleanText,
  cleanUrl,
  cleanTitle,
  cleanDescription,
  cleanShort,
};
