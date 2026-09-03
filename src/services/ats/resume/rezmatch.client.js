/**
 * Thin client for the Rezmatch.ai /match endpoint.
 *
 * Sends the candidate's CV (by public URL) + the job description text and returns a
 * normalized fit result. Uses the built-in fetch (Node 18+), so no HTTP dependency is
 * added. All Rezmatch specifics (auth header, response envelope, field names) are
 * contained here so the worker stays provider-agnostic.
 *
 * Docs: POST https://api.rezmatch.ai/match
 *   headers: { 'x-access-key': <key>, 'content-type': 'application/json' }
 *   body:    { resume_url | resume_text | resume_file, jd_text | jd_url }
 *   resp:    { success, data:{ score, band, met_requirements[], missed_requirements[],
 *              notes, ... }, credits_used, request_id }
 */

const { config } = require('../../../config/ai');
const { scoreToBand } = require('../../../utils/ats.constants');
const logger = require('../../../config/logger');

/** Error thrown for a screening failure, carrying whether a retry is worthwhile. */
class ScreeningError extends Error {
  constructor(message, { retryable = true, status } = {}) {
    super(message);
    this.name = 'ScreeningError';
    this.retryable = retryable;
    this.status = status;
  }
}

/**
 * Extract a human-readable error message from an API error body, which may put the
 * detail under error / message / detail as a string OR a nested object. Never returns
 * "[object Object]".
 */
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
 * Coerce Rezmatch's response into our stored breakdown. Tolerant of field drift.
 *
 * Real /match shape (observed):
 *   data.score (0-100), data.band, data.explanation.met[]  = { requirement, evidence },
 *   data.explanation.missed[] = { requirement, evidence }, plus optional notes/summary.
 * We also accept a few alternate field names as fallbacks.
 */
const asRequirementList = (arr) => {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === 'string') return { requirement: x };
      if (x && typeof x === 'object') {
        return {
          requirement: x.requirement || x.name || x.skill || x.label || '',
          evidence: x.evidence || x.reason || null,
        };
      }
      return null;
    })
    .filter((x) => x && x.requirement);
};

const normalizeResult = (data = {}, envelope = {}) => {
  const rawScore = data.score ?? data.match_score ?? data.overall_score;
  const score = rawScore == null ? null : Math.round(Math.max(0, Math.min(100, Number(rawScore))));
  const band = (data.band || data.match_level || scoreToBand(score) || '').toString().toLowerCase() || null;

  const explanation = data.explanation || {};
  const met = asRequirementList(
    explanation.met || data.met_requirements || data.met || data.matched_requirements
  );
  const missed = asRequirementList(
    explanation.missed || data.missed_requirements || data.missed || data.missing_requirements
  );
  const summary =
    data.summary || data.notes || explanation.notes || explanation.summary || null;

  return {
    score,
    band,
    breakdown: {
      band,
      summary,
      notes: data.notes || explanation.notes || null,
      met_requirements: met,
      missed_requirements: missed,
      provider: 'rezmatch',
      request_id: envelope.request_id || null,
      credits_used: envelope.credits_used ?? null,
    },
  };
};

/**
 * Score one resume against one job description.
 * @param {{ resumeUrl?: string, resumeText?: string, jdText: string }} input
 * @returns {Promise<{ score:number|null, band:string|null, breakdown:object }>}
 */
const match = async ({ resumeUrl, resumeText, jdText }) => {
  if (!config.enabled) {
    throw new ScreeningError('Resume screening is not enabled/configured', { retryable: false });
  }
  if (!jdText || (!resumeUrl && !resumeText)) {
    throw new ScreeningError('match() needs a jd_text and a resume url or text', {
      retryable: false,
    });
  }

  const body = { jd_text: jdText };
  if (resumeUrl) body.resume_url = resumeUrl;
  else body.resume_text = resumeText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.rezmatch.timeoutMs);

  let res;
  try {
    res = await fetch(`${config.rezmatch.baseUrl}${config.rezmatch.matchPath}`, {
      method: 'POST',
      headers: {
        'x-access-key': config.rezmatch.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Network error or timeout — worth retrying.
    throw new ScreeningError(
      err.name === 'AbortError' ? 'Rezmatch request timed out' : `Rezmatch request failed: ${err.message}`,
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
    // 4xx (except 429/408) are our fault (bad input/key/credits) — don't retry.
    // 408/429/5xx are transient — retry with backoff.
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new ScreeningError(`Rezmatch /match error (${res.status}): ${errorDetail(json, res.status)}`, {
      retryable,
      status: res.status,
    });
  }

  if (json && json.success === false) {
    throw new ScreeningError(`Rezmatch /match unsuccessful: ${errorDetail(json)}`, {
      retryable: false,
    });
  }

  const normalized = normalizeResult(json.data || json, json);
  logger.info(
    `[resume:rezmatch] scored score=${normalized.score} band=${normalized.band} ` +
      `credits=${json.credits_used ?? '?'} req=${json.request_id || '?'}`
  );
  return normalized;
};

module.exports = { match, ScreeningError };
