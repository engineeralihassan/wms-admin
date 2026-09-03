/**
 * Resume-screening configuration (Rezmatch.ai).
 *
 * We delegate the hard parts — PDF/DOCX parsing, requirement extraction, and a
 * calibrated, explainable fit score — to the Rezmatch.ai `/match` API. It takes the
 * candidate's CV (by URL) plus the job description text and returns a 0–100 score, a
 * band, and met/missed requirements with quoted evidence.
 *
 * SAFE-BY-DEFAULT: screening is only attempted when it is explicitly enabled AND an
 * API key is present. Otherwise the pipeline no-ops (applications simply stay
 * unscreened) and nothing else in the ATS is affected.
 *
 * COST MODEL: the worker calls the API ONCE per resume and caches the result on the
 * application row. Ranking / re-ranking / sorting read the cached score — zero extra
 * API cost per recruiter view.
 */

const apiKey = process.env.REZMATCH_API_KEY || null;
const enabledFlag = String(process.env.RESUME_SCREENING_ENABLED ?? 'true').toLowerCase() !== 'false';

const config = Object.freeze({
  /** True only when screening should actually run (flag on AND key present). */
  enabled: enabledFlag && Boolean(apiKey),
  /** Whether a key is configured at all (surfaced for diagnostics/health). */
  configured: Boolean(apiKey),

  rezmatch: {
    apiKey,
    baseUrl: (process.env.REZMATCH_BASE_URL || 'https://api.rezmatch.ai').replace(/\/+$/, ''),
    // Sent as the `x-access-key` header (per Rezmatch docs).
    matchPath: '/match',
    // Hard ceiling on a single API call so a slow response can't hold a worker slot.
    // /match parses the PDF + scores, so it can legitimately take ~25-40s.
    timeoutMs: Number(process.env.REZMATCH_TIMEOUT_MS || 90000),
    // Skip CVs larger than this (bytes) — very large / scanned PDFs are the slowest to
    // parse and most likely to time out or waste credits. 0 disables the guard.
    maxResumeBytes: Number(process.env.REZMATCH_MAX_RESUME_BYTES || 10 * 1024 * 1024),
  },

  /**
   * Background worker tunables — mirror the email worker's env-driven knobs so ops can
   * tune throughput without code changes. Concurrency is kept low by default to stay
   * within third-party rate limits and control credit burn.
   */
  worker: {
    enabled: String(process.env.RESUME_WORKER_ENABLED ?? 'true').toLowerCase() !== 'false',
    pollIntervalMs: Number(process.env.RESUME_POLL_INTERVAL_MS || 5000),
    batchSize: Number(process.env.RESUME_BATCH_SIZE || 20),
    concurrency: Math.max(1, Number(process.env.RESUME_CONCURRENCY || 3)),
    staleLockMs: Number(process.env.RESUME_STALE_LOCK_MS || 5 * 60 * 1000),
    maxAttempts: Number(process.env.RESUME_MAX_ATTEMPTS || 3),
  },
});

module.exports = { config };
