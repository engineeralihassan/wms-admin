const crypto = require('crypto');
const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const {
  JOB_PUBLIC_TOKEN_BYTES,
  INTERVIEW_ROUND_KEY_MAX_LENGTH,
} = require('../../utils/ats.constants');

/**
 * Shared helpers for the ATS services (jobs + applications). Keeping the tenant/
 * ownership scope logic and pipeline normalization in one place guarantees jobs and
 * applications enforce IDENTICAL visibility rules and can't drift apart.
 */

/** Does this actor see the WHOLE org's ATS (org admin), or only their own jobs? */
const canManageAllJobs = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.JOB_MANAGE_ALL);

/**
 * Build the tenant + visibility where-clause for JOB list/read queries. Fail-closed:
 * requires the request to have passed through tenantScope. Org and user ids come from
 * the signed token, never the body.
 *
 *   super_admin        -> {}                                  (all jobs, all orgs)
 *   job.manage_all      -> { organization_id }                 (all jobs in their org)
 *   recruiter (own)     -> { organization_id, created_by_id }  (only their own jobs)
 */
const buildJobScope = (req) => {
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
  if (!canManageAllJobs(auth)) {
    scope.created_by_id = auth.userId;
  }
  return scope;
};

/**
 * Application visibility mirrors job visibility: a recruiter sees applications only for
 * jobs they own; an org admin sees all. This returns the scope to apply on the parent
 * JOB when resolving which applications are visible (applications are always fetched
 * through their job).
 */
const buildApplicationJobScope = buildJobScope;

/**
 * Generate an unguessable, URL-safe public token for a job's careers link. base64url
 * so it's safe in a path segment; no padding.
 */
const generatePublicToken = () =>
  crypto.randomBytes(JOB_PUBLIC_TOKEN_BYTES).toString('base64url');

/** Turn a round name into a stable, slug-like key (a-z0-9 + underscores). */
const slugifyRoundKey = (name, index) => {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, INTERVIEW_ROUND_KEY_MAX_LENGTH);
  return base || `round_${index + 1}`;
};

/**
 * Normalize a client-supplied interview-rounds array into canonical, de-duplicated
 * [{ key, name, order }] with sequential 1-based order and unique keys. Preserves an
 * explicit key when provided (so editing a job keeps existing keys stable), otherwise
 * derives one from the name.
 */
const normalizeInterviewRounds = (rounds) => {
  if (!Array.isArray(rounds)) return [];
  const seen = new Set();
  const out = [];
  rounds.forEach((r, index) => {
    const name = String(r.name || '').trim();
    if (!name) return;
    let key = r.key ? String(r.key).trim() : slugifyRoundKey(name, index);
    // Ensure uniqueness even if two rounds slugify to the same key.
    let candidate = key;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${key}_${suffix}`;
      suffix += 1;
    }
    key = candidate;
    seen.add(key);
    out.push({ key, name, order: out.length + 1 });
  });
  return out;
};

/** Generate the next sequential human-friendly code (e.g. "JOB-000123") for a model. */
const nextSequenceCode = async (model, prefix, transaction) => {
  const maxId = (await model.max('id', { transaction })) || 0;
  return `${prefix}-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

module.exports = {
  canManageAllJobs,
  buildJobScope,
  buildApplicationJobScope,
  generatePublicToken,
  slugifyRoundKey,
  normalizeInterviewRounds,
  nextSequenceCode,
};
