/**
 * Opportunity discovery configuration (OpenWeb Ninja — JSearch).
 *
 * The Sales module's "Get latest opportunities" feature queries the JSearch job-search
 * API (real-time postings aggregated from Google for Jobs / LinkedIn / Indeed / etc.),
 * normalizes each result into our own `opportunities` table (org-scoped, idempotent),
 * and lets a user convert an opportunity into a Sales Lead.
 *
 * SAFE-BY-DEFAULT: discovery is only attempted when a `JSEARCH_API_KEY` is present.
 * Without a key the feature no-ops gracefully (the button returns a clear "not
 * configured" message) and nothing else in Sales is affected — mirrors the Rezmatch
 * resume-screening safety switch in config/ai.js.
 *
 * COST MODEL: each JSearch page (up to 10 results) costs one request credit. We cap the
 * number of pages per search (maxPages) so a single click can never burn an unbounded
 * amount of credits. Results are stored and de-duplicated on (org, source, external_id),
 * so re-running the same search does not create duplicate rows.
 *
 * The API contract lives in the thin client (services/opportunity/jsearch.client.js);
 * this file only holds tunables + the safety flag so the rest of the app is
 * provider-agnostic.
 *
 * Docs: https://www.openwebninja.com/api/jsearch/llms.txt
 */

const apiKey = process.env.JSEARCH_API_KEY || null;
const enabledFlag = String(process.env.OPPORTUNITY_DISCOVERY_ENABLED ?? 'true').toLowerCase() !== 'false';

const config = Object.freeze({
  /** True only when discovery should actually run (flag on AND key present). */
  enabled: enabledFlag && Boolean(apiKey),
  /** Whether a key is configured at all (surfaced to the UI for a clear message). */
  configured: Boolean(apiKey),

  jsearch: {
    apiKey,
    baseUrl: (process.env.JSEARCH_BASE_URL || 'https://api.openwebninja.com/jsearch').replace(
      /\/+$/,
      ''
    ),
    searchPath: '/search-v2',
    // Sent as the `x-api-key` header (per OpenWeb Ninja docs).
    // A single search can legitimately take a few seconds (Google for Jobs aggregation).
    timeoutMs: Number(process.env.JSEARCH_TIMEOUT_MS || 30000),
    // Hard ceiling on pages fetched per search click. Each page = up to 10 results = 1
    // credit. Kept small so one click can't burn credits. Allowed API range is 1–20.
    maxPages: Math.min(20, Math.max(1, Number(process.env.JSEARCH_MAX_PAGES || 1))),
    // Default country used when the caller doesn't specify one.
    defaultCountry: (process.env.JSEARCH_DEFAULT_COUNTRY || 'us').toLowerCase(),
  },

  /** Source key stored on every opportunity + registered as a Sales lead source. */
  sourceKey: 'jsearch',
  sourceLabel: 'Job Search (OpenWeb Ninja)',

  /** Per-search result cap actually persisted (defensive; API pages already bound it). */
  maxResultsPerSearch: Number(process.env.OPPORTUNITY_MAX_RESULTS || 50),
});

module.exports = { config };
