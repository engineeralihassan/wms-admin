/**
 * opportunity.service — business logic for the Sales "Get latest opportunities" feature.
 *
 * Flow: a user runs a search → we call the JSearch API → normalize each (untrusted)
 * result into our own schema → UPSERT idempotently on (org, source, external_id) → the
 * user reviews the stored opportunities and converts promising ones into Sales Leads.
 *
 * Visibility follows the owner overlay (opportunity.shared.buildOpportunityScope): a rep
 * sees only opportunities they discovered; a manager / org admin sees the whole org.
 * organization_id and the discoverer are always derived server-side, never trusted.
 *
 * External content is treated as DATA, never instructions: all text is sanitized + length
 * capped before persisting, URLs are restricted to http(s), and nothing is rendered as HTML.
 */

const httpStatus = require('http-status');
const { Op } = require('sequelize');
const { Opportunity, Lead, LeadEvent, SalesConfig, sequelize } = require('../../models');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { paginate } = require('../../utils/query/paginate');
const { OPPORTUNITY_QUERY_CONFIG } = require('../../config/query-configs');
const { config: opportunityConfig } = require('../../config/opportunity');
const jsearch = require('./jsearch.client');
const {
  buildOpportunityScope,
  cleanTitle,
  cleanDescription,
  cleanShort,
  cleanUrl,
  cleanText,
} = require('./opportunity.shared');
const {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_USER_SETTABLE_STATUSES,
} = require('../../utils/opportunity.constants');
const {
  LEAD_STATUSES,
  LEAD_EVENT_TYPES,
  LEAD_CODE_PREFIX,
} = require('../../utils/sales.constants');
const { nextSequenceCode } = require('../sales/sales.shared');
const { ensureSalesConfig } = require('../sales/sales-config.service');

/** Public-facing attribute list (no raw_payload — it's large + internal). */
const OPPORTUNITY_ATTRIBUTES = [
  'id',
  'uuid',
  'source',
  'external_id',
  'opportunity_type',
  'title',
  'description',
  'company_name',
  'company_website',
  'employment_type',
  'location',
  'is_remote',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_period',
  'salary_display',
  'apply_url',
  'source_url',
  'publisher',
  'posted_at',
  'discovered_at',
  'last_seen_at',
  'status',
  'search_query',
  'converted_lead_id',
  'converted_at',
  'createdAt',
  'updatedAt',
];

/** Parse a JSearch timestamp (epoch seconds or ISO string) into a Date or null. */
const parsePostedAt = (job) => {
  if (job.job_posted_at_timestamp) {
    const ms = Number(job.job_posted_at_timestamp) * 1000;
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  if (job.job_posted_at_datetime_utc) {
    const d = new Date(job.job_posted_at_datetime_utc);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

const toDecimalOrNull = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Map ONE raw (untrusted) JSearch job into our normalized, sanitized shape. Returns null
 * when the job lacks the minimum viable fields (external id + title).
 */
const normalizeJob = (job, { organizationId, discoveredById, searchQuery, now }) => {
  const externalId = cleanText(job.job_id || job.job_uid, 512);
  const title = cleanTitle(job.job_title);
  if (!externalId || !title) return null;

  const applyUrl =
    cleanUrl(job.job_apply_link) ||
    cleanUrl(Array.isArray(job.apply_options) && job.apply_options[0] && job.apply_options[0].apply_link);

  const location =
    cleanShort(job.job_location) ||
    cleanShort([job.job_city, job.job_state, job.job_country].filter(Boolean).join(', '));

  return {
    organization_id: organizationId,
    discovered_by_id: discoveredById,
    source: OPPORTUNITY_SOURCES.JSEARCH,
    external_id: externalId,
    opportunity_type: OPPORTUNITY_TYPES.JOB,
    title,
    description: cleanDescription(job.job_description),
    company_name: cleanShort(job.employer_name),
    company_website: cleanUrl(job.employer_website),
    employment_type: cleanShort(job.job_employment_type),
    location,
    is_remote: Boolean(job.job_is_remote),
    salary_min: toDecimalOrNull(job.job_min_salary),
    salary_max: toDecimalOrNull(job.job_max_salary),
    salary_currency: cleanText(job.job_salary_currency, 3),
    salary_period: cleanText(job.job_salary_period, 20),
    // Pre-formatted, human-friendly salary text from the source — preferred for
    // display since the numeric fields often come back without a currency.
    salary_display: cleanText(job.job_salary_string, 120),
    apply_url: applyUrl,
    source_url: cleanUrl(job.job_google_link) || applyUrl,
    publisher: cleanShort(job.job_publisher),
    posted_at: parsePostedAt(job),
    discovered_at: now,
    last_seen_at: now,
    search_query: cleanTitle(searchQuery),
    raw_payload: job,
  };
};

/**
 * Upsert one normalized row idempotently on (org, source, external_id). Preserves a
 * user's status/conversion on re-discovery — only refreshes the mutable content fields
 * and bumps last_seen_at. Returns { row, created }.
 */
const upsertOpportunity = async (normalized, transaction) => {
  const existing = await Opportunity.findOne({
    where: {
      organization_id: normalized.organization_id,
      source: normalized.source,
      external_id: normalized.external_id,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!existing) {
    const row = await Opportunity.create(normalized, { transaction });
    return { row, created: true };
  }

  // Re-seen: refresh content + last_seen_at, keep the user's status/ownership/conversion.
  await existing.update(
    {
      title: normalized.title,
      description: normalized.description,
      company_name: normalized.company_name,
      company_website: normalized.company_website,
      employment_type: normalized.employment_type,
      location: normalized.location,
      is_remote: normalized.is_remote,
      salary_min: normalized.salary_min,
      salary_max: normalized.salary_max,
      salary_currency: normalized.salary_currency,
      salary_period: normalized.salary_period,
      salary_display: normalized.salary_display,
      apply_url: normalized.apply_url,
      source_url: normalized.source_url,
      publisher: normalized.publisher,
      posted_at: normalized.posted_at,
      last_seen_at: normalized.last_seen_at,
      raw_payload: normalized.raw_payload,
    },
    { transaction }
  );
  return { row: existing, created: false };
};

/**
 * Run a discovery search and persist the results (idempotent). Returns a summary plus
 * the freshly upserted opportunities (public shape).
 *
 * @param {object} criteria { query, country?, datePosted?, workFromHome?, employmentTypes?, numPages? }
 */
const discover = async (criteria, req, res) => {
  if (!opportunityConfig.enabled) {
    // 503: the feature exists but isn't configured (no API key). Clear, non-retryable.
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, res.__('opportunity_not_configured'));
  }

  const organizationId = req.auth.organizationId;
  const discoveredById = req.auth.userId;
  const now = new Date();

  let jobs;
  try {
    ({ jobs } = await jsearch.search(criteria));
  } catch (err) {
    logger.error(`[opportunity] discovery failed: ${err.message}`);
    // Map the upstream status to a clear, actionable client message. We deliberately
    // don't echo the raw provider text, but we DO distinguish the fixable cases:
    //   401/403 -> the JSearch API key is missing/invalid or the account isn't
    //              subscribed to this API (an admin/config problem, not transient).
    //   429     -> rate limit / quota — retry later.
    //   else    -> generic upstream failure.
    const status = err instanceof jsearch.DiscoveryError ? err.status : undefined;
    if (status === 401 || status === 403) {
      throw new ApiError(httpStatus.BAD_GATEWAY, res.__('opportunity_provider_unauthorized'));
    }
    if (status === 429) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, res.__('opportunity_provider_rate_limited'));
    }
    throw new ApiError(httpStatus.BAD_GATEWAY, res.__('opportunity_discovery_failed'));
  }

  const capped = jobs.slice(0, opportunityConfig.maxResultsPerSearch);

  let createdCount = 0;
  const rows = [];
  // Persist inside a transaction so a batch either lands or doesn't (idempotent either way).
  await sequelize.transaction(async (transaction) => {
    for (const job of capped) {
      const normalized = normalizeJob(job, {
        organizationId,
        discoveredById,
        searchQuery: criteria.query,
        now,
      });
      if (!normalized) continue;
      // eslint-disable-next-line no-await-in-loop
      const { row, created } = await upsertOpportunity(normalized, transaction);
      if (created) createdCount += 1;
      rows.push(row);
    }
  });

  logger.info(
    `[opportunity] org=${organizationId} discovered=${rows.length} new=${createdCount} ` +
      `query="${String(criteria.query || '').slice(0, 60)}"`
  );

  // Reload the public shape (drops raw_payload) for the response.
  const uuids = rows.map((r) => r.uuid);
  const persisted = uuids.length
    ? await Opportunity.findAll({
        where: { uuid: { [Op.in]: uuids } },
        attributes: OPPORTUNITY_ATTRIBUTES,
        order: [['discovered_at', 'DESC']],
      })
    : [];

  return {
    summary: { total: rows.length, created: createdCount, updated: rows.length - createdCount },
    opportunities: persisted,
  };
};

/** List discovered opportunities (tenant + owner scoped). */
const listOpportunities = async (req) =>
  paginate(Opportunity, req.query, OPPORTUNITY_QUERY_CONFIG, {
    scopeWhere: buildOpportunityScope(req),
    attributes: OPPORTUNITY_ATTRIBUTES,
  });

/** Fetch one opportunity the caller may see, or throw 404. */
const findVisible = async (uuid, req, res, transaction) => {
  const row = await Opportunity.findOne({
    where: { uuid, ...buildOpportunityScope(req) },
    attributes: OPPORTUNITY_ATTRIBUTES,
    transaction,
  });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('opportunity_not_found'));
  }
  return row;
};

/** Read one opportunity. */
const getOpportunity = async (uuid, req, res) => findVisible(uuid, req, res);

/**
 * Set a user-settable status (new | saved | rejected). Converting is a separate route.
 * A converted opportunity is immutable here.
 */
const setStatus = async (uuid, status, req, res) => {
  if (!OPPORTUNITY_USER_SETTABLE_STATUSES.includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('opportunity_invalid_status'));
  }
  const row = await Opportunity.findOne({ where: { uuid, ...buildOpportunityScope(req) } });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('opportunity_not_found'));
  }
  if (row.status === OPPORTUNITY_STATUSES.CONVERTED) {
    throw new ApiError(httpStatus.CONFLICT, res.__('opportunity_already_converted'));
  }
  row.status = status;
  await row.save();
  return findVisible(uuid, req, res);
};

/** Delete a discovered opportunity (manager/admin action; scope enforces this). */
const deleteOpportunity = async (uuid, req, res) => {
  const row = await Opportunity.findOne({ where: { uuid, ...buildOpportunityScope(req) } });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('opportunity_not_found'));
  }
  await row.destroy();
};

/**
 * Convert an opportunity into a Sales Lead. Idempotent: converting an already-converted
 * opportunity returns its existing lead. The created lead reuses the sales lead pattern
 * (sequence code, LeadEvent audit) and records `source = 'jsearch'` (registered as a
 * lead source on the org's SalesConfig so it passes lead-source validation elsewhere).
 *
 * @param {object} body optional overrides { first_name?, company_name?, estimated_value? }
 */
const convertToLead = async (uuid, body, req, res) => {
  const organizationId = req.auth.organizationId;

  const result = await sequelize.transaction(async (transaction) => {
    const opp = await Opportunity.findOne({
      where: { uuid, ...buildOpportunityScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!opp) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('opportunity_not_found'));
    }
    if (opp.status === OPPORTUNITY_STATUSES.CONVERTED && opp.converted_lead_id) {
      // Idempotent: already converted — return the existing lead.
      const existingLead = await Lead.findByPk(opp.converted_lead_id, { transaction });
      return { lead: existingLead, opportunity: opp, alreadyConverted: true };
    }

    // Make sure the org has a SalesConfig and that 'jsearch' is a registered lead source
    // so the lead's source passes validation consistently across the sales module.
    const salesConfig = await ensureSalesConfig(organizationId, req.auth.userId, transaction);
    const sources = Array.isArray(salesConfig.lead_sources) ? salesConfig.lead_sources : [];
    if (!sources.some((s) => s.key === opportunityConfig.sourceKey)) {
      salesConfig.lead_sources = [
        ...sources,
        { key: opportunityConfig.sourceKey, label: opportunityConfig.sourceLabel, active: true },
      ];
      await salesConfig.save({ transaction });
    }

    // Build the lead from the opportunity. A JOB opportunity is company-centric, so map
    // the employer into the lead's company fields; the person name defaults to the
    // company (there's no contact person on a job posting) unless the caller overrides.
    const companyName = body.company_name || opp.company_name || null;
    const firstName = body.first_name || companyName || opp.title;

    const lead_number = await nextSequenceCode(Lead, LEAD_CODE_PREFIX, transaction);
    const lead = await Lead.create(
      {
        lead_number,
        organization_id: organizationId,
        owner_id: req.auth.userId,
        created_by_id: req.auth.userId,
        first_name: String(firstName).slice(0, 150),
        last_name: null,
        email: null,
        phone: null,
        job_title: null,
        company_name: companyName,
        industry: null,
        website: opp.company_website || null,
        source: opportunityConfig.sourceKey,
        status: LEAD_STATUSES.NEW,
        estimated_value:
          body.estimated_value != null
            ? body.estimated_value
            : opp.salary_max ?? opp.salary_min ?? null,
        currency: opp.salary_currency || null,
        custom_fields: {},
      },
      { transaction }
    );

    await LeadEvent.create(
      {
        organization_id: organizationId,
        lead_id: lead.id,
        created_by_id: req.auth.userId,
        entry_type: LEAD_EVENT_TYPES.CREATED,
        from_value: null,
        to_value: LEAD_STATUSES.NEW,
        note: `Created from opportunity: ${opp.title}`.slice(0, 2000),
      },
      { transaction }
    );

    opp.status = OPPORTUNITY_STATUSES.CONVERTED;
    opp.converted_lead_id = lead.id;
    opp.converted_at = new Date();
    await opp.save({ transaction });

    return { lead, opportunity: opp, alreadyConverted: false };
  });

  return result;
};

module.exports = {
  OPPORTUNITY_ATTRIBUTES,
  discover,
  listOpportunities,
  getOpportunity,
  setStatus,
  deleteOpportunity,
  convertToLead,
};
