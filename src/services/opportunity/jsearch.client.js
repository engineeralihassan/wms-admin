/**
 * Thin client for the OpenWeb Ninja JSearch job-search API.
 *
 * Wraps GET /search-v2 (real-time job postings aggregated from Google for Jobs and the
 * open web). Uses the built-in fetch (Node 18+), so no HTTP dependency is added. All
 * JSearch specifics (auth header, query params, response envelope, field names) are
 * contained here so the service layer stays provider-agnostic.
 *
 * Auth: API key in the `x-api-key` header.
 * Docs: https://www.openwebninja.com/api/jsearch/llms.txt
 *
 * IMPORTANT: everything returned here is UNTRUSTED external content. The service that
 * consumes it must treat titles/descriptions as data (never HTML, never instructions)
 * and cap field lengths before persisting.
 */

const { config } = require('../../config/opportunity');
const logger = require('../../config/logger');

/** Error thrown for a discovery failure, carrying whether a retry is worthwhile. */
class DiscoveryError extends Error {
  constructor(message, { retryable = true, status } = {}) {
    super(message);
    this.name = 'DiscoveryError';
    this.retryable = retryable;
    this.status = status;
  }
}

/** Pull a readable message out of an error body without ever returning "[object Object]". */
const errorDetail = (json, fallbackStatus) => {
  const raw = json && (json.error || json.message || json.detail);
  if (!raw) return fallbackStatus ? `HTTP ${fallbackStatus}` : 'unknown error';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    return raw.message || raw.detail || raw.code || JSON.stringify(raw).slice(0, 300);
  }
  return String(raw);
};

/**
 * Build the /search-v2 query string from a normalized criteria object. Only whitelisted
 * params are ever forwarded — arbitrary keys can't leak into the upstream request.
 *
 * @param {object} criteria
 * @param {string} criteria.query               required free-form query (title + location)
 * @param {string} [criteria.country]           ISO 3166-1 alpha-2 (default from config)
 * @param {string} [criteria.datePosted]        all|today|3days|week|month
 * @param {boolean} [criteria.workFromHome]      remote only
 * @param {string} [criteria.employmentTypes]    comma list: FULLTIME|CONTRACTOR|PARTTIME|INTERN
 * @param {number} [criteria.numPages]           1..maxPages
 * @param {string} [criteria.cursor]             pagination cursor from a previous response
 */
const buildParams = (criteria = {}) => {
  const params = new URLSearchParams();
  params.set('query', String(criteria.query || '').trim());
  params.set('country', (criteria.country || config.jsearch.defaultCountry).toLowerCase());

  const pages = Math.min(config.jsearch.maxPages, Math.max(1, Number(criteria.numPages) || 1));
  params.set('num_pages', String(pages));

  if (criteria.datePosted && criteria.datePosted !== 'all') {
    params.set('date_posted', criteria.datePosted);
  }
  if (criteria.workFromHome) {
    params.set('work_from_home', 'true');
  }
  if (criteria.employmentTypes) {
    params.set('employment_types', criteria.employmentTypes);
  }
  if (criteria.cursor) {
    params.set('cursor', criteria.cursor);
  }
  return params;
};

/**
 * Low-level GET to a JSearch endpoint with timeout + error classification.
 * Returns the parsed JSON body.
 */
const get = async (path, params) => {
  if (!config.enabled) {
    throw new DiscoveryError('Opportunity discovery is not enabled/configured', {
      retryable: false,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.jsearch.timeoutMs);

  const qs = params && params.toString();
  const url = `${config.jsearch.baseUrl}${path}${qs ? `?${qs}` : ''}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': config.jsearch.apiKey, accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    // Network error or timeout — worth retrying.
    throw new DiscoveryError(
      err.name === 'AbortError'
        ? `JSearch ${path} timed out`
        : `JSearch ${path} request failed: ${err.message}`,
      { retryable: true }
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    // 401/403 (bad key) and 4xx (bad input) are our fault — don't retry.
    // 408/429/5xx are transient — retryable.
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new DiscoveryError(
      `JSearch ${path} error (${res.status}): ${errorDetail(json, res.status)}`,
      { retryable, status: res.status }
    );
  }
  return json;
};

/**
 * Normalize the various JSearch response shapes into a flat { jobs, cursor }.
 *
 * Observed shapes (be tolerant of drift):
 *   { status, data: { jobs: [...], cursor } }   ← current /search-v2 envelope
 *   { data: [ ...jobs ], cursor }                ← older array-under-data shape
 *   [ ...jobs ]                                  ← bare array (some samples)
 */
const unwrap = (json) => {
  if (Array.isArray(json)) return { jobs: json, cursor: null };
  if (!json || typeof json !== 'object') return { jobs: [], cursor: null };

  // Current shape: data is an object holding { jobs, cursor }.
  if (json.data && !Array.isArray(json.data) && Array.isArray(json.data.jobs)) {
    return { jobs: json.data.jobs, cursor: json.data.cursor || json.cursor || null };
  }
  // Older shape: data is the jobs array directly.
  if (Array.isArray(json.data)) {
    return { jobs: json.data, cursor: json.cursor || null };
  }
  // Last resort: a top-level jobs array.
  if (Array.isArray(json.jobs)) {
    return { jobs: json.jobs, cursor: json.cursor || null };
  }
  return { jobs: [], cursor: json.cursor || null };
};

/**
 * Search for jobs. Returns the raw (untrusted) job objects + a pagination cursor.
 * @returns {Promise<{ jobs: object[], cursor: string|null }>}
 */
const search = async (criteria) => {
  const json = await get(config.jsearch.searchPath, buildParams(criteria));
  const { jobs, cursor } = unwrap(json);
  logger.info(
    `[opportunity:jsearch] search "${String(criteria.query || '').slice(0, 80)}" -> ${jobs.length} result(s)`
  );
  return { jobs, cursor };
};

module.exports = { search, DiscoveryError };
