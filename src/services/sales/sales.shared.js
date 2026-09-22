const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const {
  PIPELINE_STAGE_KEY_MAX_LENGTH,
  PIPELINE_MAX_STAGES,
  CUSTOM_FIELD_TYPES,
} = require('../../utils/sales.constants');

/**
 * Shared helpers for the Sales services (leads, accounts, contacts, deals, activities,
 * pipelines, teams). Centralizing the tenant/ownership scope logic, stage normalization,
 * sequence codes and custom-field validation guarantees every sales resource enforces
 * IDENTICAL visibility rules and can't drift apart — the same role ats.shared.js plays
 * for the ATS.
 */

// ── Visibility overlays ──────────────────────────────────────────────────────
/**
 * Does this actor see the WHOLE org for a given resource (manager/admin), or only their
 * own records (rep)? Mirrors canManageAllJobs. super_admin always sees everything.
 */
const canManageAll = (auth, manageAllPerm) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(manageAllPerm);

/**
 * Build the tenant + visibility where-clause for a sales resource. FAIL-CLOSED: requires
 * the request to have passed through tenantScope (else 500). Org and user ids come from
 * the signed token, never the body — cross-tenant reads are structurally impossible.
 *
 *   super_admin                 -> {}                                (all orgs)
 *   holder of <manageAllPerm>   -> { organization_id }              (whole org)
 *   everyone else               -> { organization_id, [ownerField]: userId }  (own only)
 *
 * @param {object} req
 * @param {object} opts
 * @param {string} opts.manageAllPerm  permission that grants whole-org visibility.
 * @param {string} [opts.ownerField='owner_id']  the column holding the record owner.
 */
const buildSalesScope = (req, { manageAllPerm, ownerField = 'owner_id' } = {}) => {
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
  if (manageAllPerm && !canManageAll(auth, manageAllPerm)) {
    scope[ownerField] = auth.userId;
  }
  return scope;
};

// Convenience wrappers per resource so callers can't pass the wrong permission.
const buildLeadScope = (req) => buildSalesScope(req, { manageAllPerm: PERMISSIONS.LEAD_MANAGE_ALL });
const buildAccountScope = (req) =>
  buildSalesScope(req, { manageAllPerm: PERMISSIONS.ACCOUNT_MANAGE_ALL });
const buildDealScope = (req) => buildSalesScope(req, { manageAllPerm: PERMISSIONS.DEAL_MANAGE_ALL });

/**
 * Contacts have no dedicated manage_all permission — their visibility follows accounts.
 * A holder of account.manage_all sees all contacts in the org; everyone else sees only
 * contacts they own. Same shape, driven by the account overlay.
 */
const buildContactScope = (req) =>
  buildSalesScope(req, { manageAllPerm: PERMISSIONS.ACCOUNT_MANAGE_ALL });

/**
 * True when the caller is a sales MANAGER-level actor: super admin, or a holder of any
 * of the sales manage_all overlays. Used for cross-cutting resources (activities, teams,
 * dashboard) that aren't tied to a single record type — a manager sees the whole org's
 * activity, a rep sees their own.
 */
const isSalesManager = (auth) =>
  auth.isSuperAdmin ||
  (auth.permissions || []).some((p) =>
    [
      PERMISSIONS.LEAD_MANAGE_ALL,
      PERMISSIONS.DEAL_MANAGE_ALL,
      PERMISSIONS.ACCOUNT_MANAGE_ALL,
      PERMISSIONS.SALES_TEAM_MANAGE,
    ].includes(p)
  );

/**
 * Build a sales-wide scope for cross-cutting resources: manager -> whole org; rep -> own.
 * Fail-closed like buildSalesScope. ownerField defaults to owner_id.
 */
const buildSalesWideScope = (req, ownerField = 'owner_id') => {
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
  if (!isSalesManager(auth)) {
    scope[ownerField] = auth.userId;
  }
  return scope;
};

// ── Pipeline stage normalization (the interview_rounds pattern) ───────────────
/** Turn a stage name into a stable, slug-like key (a-z0-9 + underscores). */
const slugifyStageKey = (name, index) => {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, PIPELINE_STAGE_KEY_MAX_LENGTH);
  return base || `stage_${index + 1}`;
};

const clampProbability = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

/**
 * Normalize a client-supplied stages array into canonical, de-duplicated
 * [{ key, name, order, probability, is_won, is_lost }] with sequential 1-based order and
 * unique keys. Preserves an explicit key when provided (so editing a pipeline keeps
 * existing keys — and thus deals' stage_key — stable), otherwise derives one from the
 * name. Enforces EXACTLY one is_won and one is_lost terminal stage.
 *
 * Copied in shape from normalizeInterviewRounds, extended with probability + won/lost.
 */
const normalizeStages = (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A pipeline must have at least one stage');
  }
  if (stages.length > PIPELINE_MAX_STAGES) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A pipeline may have at most ${PIPELINE_MAX_STAGES} stages`
    );
  }
  const seen = new Set();
  const out = [];
  let wonCount = 0;
  let lostCount = 0;
  stages.forEach((s, index) => {
    const name = String(s.name || '').trim();
    if (!name) return;
    let key = s.key ? String(s.key).trim() : slugifyStageKey(name, index);
    let candidate = key;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${key}_${suffix}`;
      suffix += 1;
    }
    key = candidate;
    seen.add(key);
    const isWon = Boolean(s.is_won);
    const isLost = Boolean(s.is_lost);
    if (isWon && isLost) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Stage "${name}" cannot be both won and lost`);
    }
    if (isWon) wonCount += 1;
    if (isLost) lostCount += 1;
    out.push({
      key,
      name,
      order: out.length + 1,
      probability: clampProbability(s.probability),
      is_won: isWon,
      is_lost: isLost,
    });
  });
  if (out.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A pipeline must have at least one named stage');
  }
  if (wonCount !== 1 || lostCount !== 1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'A pipeline must have exactly one won stage and one lost stage'
    );
  }
  return out;
};

/** Find a stage in a pipeline's stages[] by key, or throw 400. */
const getStageOrThrow = (pipeline, stageKey) => {
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  const stage = stages.find((s) => s.key === stageKey);
  if (!stage) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown stage "${stageKey}" for this pipeline`);
  }
  return stage;
};

/** Derive a deal's status ('open'|'won'|'lost') from its current stage flags. */
const statusFromStage = (stage) => {
  if (stage?.is_won) return 'won';
  if (stage?.is_lost) return 'lost';
  return 'open';
};

// ── Sequence codes (human-friendly identifiers) ──────────────────────────────
/** Generate the next sequential code (e.g. "LEAD-000123") for a model. */
const nextSequenceCode = async (model, prefix, transaction) => {
  const maxId = (await model.max('id', { transaction })) || 0;
  return `${prefix}-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

// ── Custom-field validation (the "dynamic without chaos" guardrail) ───────────
/**
 * Validate a row's custom_fields object against the org's declared definitions for an
 * entity. Unknown keys are rejected, required fields enforced, and each value is
 * type-checked — so JSONB is never a free-for-all. Returns a cleaned object containing
 * only defined keys. `defs` is SalesConfig.custom_fields[entity] ([] when none).
 */
const validateCustomFields = (values, defs) => {
  const provided = values && typeof values === 'object' ? values : {};
  const definitions = Array.isArray(defs) ? defs : [];
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  // Reject keys that aren't declared.
  for (const key of Object.keys(provided)) {
    if (!byKey.has(key)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown custom field "${key}"`);
    }
  }

  const cleaned = {};
  for (const def of definitions) {
    const raw = provided[def.key];
    const isEmpty = raw === undefined || raw === null || raw === '';
    if (isEmpty) {
      if (def.required) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Custom field "${def.label || def.key}" is required`);
      }
      continue;
    }
    cleaned[def.key] = coerceCustomFieldValue(raw, def);
  }
  return cleaned;
};

/** Type-check and coerce a single custom-field value against its definition. */
const coerceCustomFieldValue = (raw, def) => {
  const label = def.label || def.key;
  switch (def.type) {
    case CUSTOM_FIELD_TYPES.NUMBER:
    case CUSTOM_FIELD_TYPES.CURRENCY: {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ApiError(httpStatus.BAD_REQUEST, `"${label}" must be a number`);
      return n;
    }
    case CUSTOM_FIELD_TYPES.CHECKBOX:
      return Boolean(raw);
    case CUSTOM_FIELD_TYPES.DATE: {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, `"${label}" must be a date`);
      return d.toISOString();
    }
    case CUSTOM_FIELD_TYPES.SELECT: {
      const options = Array.isArray(def.options) ? def.options : [];
      if (options.length && !options.includes(raw)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `"${label}" has an invalid option`);
      }
      return String(raw);
    }
    case CUSTOM_FIELD_TYPES.MULTISELECT: {
      const options = Array.isArray(def.options) ? def.options : [];
      const arr = Array.isArray(raw) ? raw : [raw];
      if (options.length && arr.some((v) => !options.includes(v))) {
        throw new ApiError(httpStatus.BAD_REQUEST, `"${label}" has an invalid option`);
      }
      return arr.map(String);
    }
    case CUSTOM_FIELD_TYPES.EMAIL: {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(raw))) {
        throw new ApiError(httpStatus.BAD_REQUEST, `"${label}" must be a valid email`);
      }
      return String(raw);
    }
    case CUSTOM_FIELD_TYPES.URL:
    case CUSTOM_FIELD_TYPES.PHONE:
    case CUSTOM_FIELD_TYPES.TEXT:
    default:
      return String(raw);
  }
};

/** Validate a lead's `source` against the org's active lead sources (if any defined). */
const assertValidLeadSource = (source, salesConfig) => {
  if (!source) return;
  const sources = Array.isArray(salesConfig?.lead_sources) ? salesConfig.lead_sources : [];
  const active = sources.filter((s) => s.active !== false).map((s) => s.key);
  if (active.length && !active.includes(source)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown lead source "${source}"`);
  }
};

module.exports = {
  canManageAll,
  buildSalesScope,
  buildLeadScope,
  buildAccountScope,
  buildDealScope,
  buildContactScope,
  isSalesManager,
  buildSalesWideScope,
  slugifyStageKey,
  clampProbability,
  normalizeStages,
  getStageOrThrow,
  statusFromStage,
  nextSequenceCode,
  validateCustomFields,
  coerceCustomFieldValue,
  assertValidLeadSource,
};
