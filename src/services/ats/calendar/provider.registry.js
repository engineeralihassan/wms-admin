const logger = require('../../../config/logger');
const { INTERVIEW_PROVIDERS } = require('../../../utils/ats.constants');
const { config: calendarConfig, isKnownProvider } = require('../../../config/calendar');
const manualProvider = require('./manual.provider');
const googleProvider = require('./google.provider');
const teamsProvider = require('./teams.provider');

/**
 * Calendar provider registry — the single extension point for interview delivery.
 *
 * Every provider implements the same contract (createEvent/updateEvent/cancelEvent +
 * isEnabled). To add Zoom later: drop a zoom.provider.js implementing that contract,
 * add it here, add its enum value + config block — nothing else in the scheduler changes.
 *
 * `resolve()` returns the requested provider IF it's enabled; otherwise it transparently
 * falls back to `manual` and logs why. That fallback is what lets a recruiter pick
 * "Google" in the UI and still get a working (manual) booking before credentials exist,
 * rather than a hard failure.
 */
const REGISTRY = Object.freeze({
  [INTERVIEW_PROVIDERS.MANUAL]: manualProvider,
  [INTERVIEW_PROVIDERS.GOOGLE]: googleProvider,
  [INTERVIEW_PROVIDERS.TEAMS]: teamsProvider,
});

/** Resolve a usable provider for a requested key, falling back to manual. */
const resolve = (requested) => {
  const wanted = (requested || calendarConfig.defaultProvider || INTERVIEW_PROVIDERS.MANUAL)
    .toString()
    .toLowerCase();

  if (!isKnownProvider(wanted) || !REGISTRY[wanted]) {
    logger.warn(`[calendar] unknown provider "${wanted}", using manual`);
    return { provider: REGISTRY[INTERVIEW_PROVIDERS.MANUAL], effectiveKey: INTERVIEW_PROVIDERS.MANUAL };
  }

  const provider = REGISTRY[wanted];
  if (typeof provider.isEnabled === 'function' && !provider.isEnabled()) {
    logger.warn(
      `[calendar] provider "${wanted}" is not configured/enabled — falling back to manual`
    );
    return { provider: REGISTRY[INTERVIEW_PROVIDERS.MANUAL], effectiveKey: INTERVIEW_PROVIDERS.MANUAL };
  }

  return { provider, effectiveKey: wanted };
};

/** Public snapshot of which providers are available (for the UI to render options). */
const listAvailable = () =>
  Object.keys(REGISTRY).map((key) => ({
    key,
    enabled: typeof REGISTRY[key].isEnabled === 'function' ? REGISTRY[key].isEnabled() : true,
    configured: Boolean(calendarConfig.providers[key]?.configured),
  }));

module.exports = { resolve, listAvailable, REGISTRY };
