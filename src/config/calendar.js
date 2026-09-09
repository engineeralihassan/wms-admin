/**
 * Interview calendar / meeting provider configuration.
 *
 * The interview scheduler mints calendar events + meeting links through a pluggable
 * provider layer (see services/ats/calendar). This module reads the per-provider
 * credentials from env and reports, for each provider, whether it is `configured`
 * (credentials present) and `enabled` (turned on AND configured).
 *
 * SAFE-BY-DEFAULT (mirrors config/ai.js): the `manual` provider is ALWAYS available and
 * needs no credentials — the recruiter supplies the meeting link / location themselves.
 * So the whole scheduling feature works end-to-end before any Google/Teams integration
 * is set up. When credentials are added and the provider is enabled, the same code path
 * transparently creates real external events instead.
 */

const { INTERVIEW_PROVIDERS, INTERVIEW_LIMITS } = require('../utils/ats.constants');

const bool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() !== 'false';
};

// ── Google Calendar (Meet links via conferenceData) ──────────────────────────────
const googleClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || null;
const googleClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || null;
const googleRefreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || null;
const googleServiceAccount = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON || null;
// Either an OAuth refresh-token flow OR a service-account JSON is enough to authenticate.
const googleConfigured =
  Boolean(googleClientId && googleClientSecret && googleRefreshToken) ||
  Boolean(googleServiceAccount);

// ── Microsoft Teams (online meetings via Microsoft Graph) ─────────────────────────
const teamsTenantId = process.env.MS_TEAMS_TENANT_ID || null;
const teamsClientId = process.env.MS_TEAMS_CLIENT_ID || null;
const teamsClientSecret = process.env.MS_TEAMS_CLIENT_SECRET || null;
const teamsOrganizerId = process.env.MS_TEAMS_ORGANIZER_USER_ID || null;
const teamsConfigured = Boolean(teamsTenantId && teamsClientId && teamsClientSecret);

const config = Object.freeze({
  // Default provider a recruiter gets pre-selected when scheduling. Falls back to
  // manual so nothing breaks before an integration is wired up.
  defaultProvider:
    (process.env.INTERVIEW_DEFAULT_PROVIDER || INTERVIEW_PROVIDERS.MANUAL).toLowerCase(),

  // Scheduling guardrails, env-overridable (defaults live in the constants).
  scheduling: Object.freeze({
    slotGranularityMinutes: Number(
      process.env.INTERVIEW_SLOT_GRANULARITY_MIN || INTERVIEW_LIMITS.DEFAULT_SLOT_GRANULARITY_MINUTES
    ),
    bufferMinutes: Number(
      process.env.INTERVIEW_BUFFER_MIN || INTERVIEW_LIMITS.DEFAULT_BUFFER_MINUTES
    ),
    defaultDurationMinutes: Number(
      process.env.INTERVIEW_DEFAULT_DURATION_MIN || INTERVIEW_LIMITS.DEFAULT_DURATION_MINUTES
    ),
  }),

  providers: Object.freeze({
    [INTERVIEW_PROVIDERS.MANUAL]: Object.freeze({
      configured: true,
      enabled: true,
    }),

    [INTERVIEW_PROVIDERS.GOOGLE]: Object.freeze({
      configured: googleConfigured,
      enabled: bool(process.env.GOOGLE_CALENDAR_ENABLED, true) && googleConfigured,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      refreshToken: googleRefreshToken,
      serviceAccountJson: googleServiceAccount,
      // Calendar the events are created on; "primary" is the authenticated user's.
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeoutMs: Number(process.env.GOOGLE_CALENDAR_TIMEOUT_MS || 15000),
    }),

    [INTERVIEW_PROVIDERS.TEAMS]: Object.freeze({
      configured: teamsConfigured,
      enabled: bool(process.env.MS_TEAMS_ENABLED, true) && teamsConfigured,
      tenantId: teamsTenantId,
      clientId: teamsClientId,
      clientSecret: teamsClientSecret,
      // The user whose calendar/online-meeting the event is created under.
      organizerUserId: teamsOrganizerId,
      timeoutMs: Number(process.env.MS_TEAMS_TIMEOUT_MS || 15000),
    }),
  }),
});

/** True when the named provider is enabled AND has credentials. */
const isProviderEnabled = (provider) => Boolean(config.providers[provider]?.enabled);

/** True when the named provider is a known provider at all. */
const isKnownProvider = (provider) =>
  Object.prototype.hasOwnProperty.call(config.providers, provider);

module.exports = { config, isProviderEnabled, isKnownProvider };
