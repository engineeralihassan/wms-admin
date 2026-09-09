const https = require('https');
const logger = require('../../../config/logger');
const { config: calendarConfig, isProviderEnabled } = require('../../../config/calendar');
const { INTERVIEW_PROVIDERS } = require('../../../utils/ats.constants');

/**
 * TeamsProvider — creates a Microsoft Teams online meeting via Microsoft Graph using the
 * client-credentials (app-only) flow, then returns the join URL.
 *
 * Implemented against Graph's REST API directly (Node's built-in https) so it needs NO
 * extra npm dependency — it works as soon as you set MS_TEAMS_* credentials. If a call
 * fails or the provider isn't configured, it degrades gracefully to a manual-style
 * result so the booking itself never fails because of a calendar hiccup.
 *
 * Graph endpoints used:
 *   POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token   (get token)
 *   POST https://graph.microsoft.com/v1.0/users/{organizer}/onlineMeetings
 */
const key = INTERVIEW_PROVIDERS.TEAMS;
const GRAPH_HOST = 'graph.microsoft.com';
const LOGIN_HOST = 'login.microsoftonline.com';

const isEnabled = () => isProviderEnabled(key);

/** Minimal JSON HTTPS request helper (promise-based, timeout-guarded). */
const request = (options, body) =>
  new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (err) {
          parsed = { raw };
        }
        if (status >= 200 && status < 300) resolve(parsed);
        else reject(new Error(`Graph ${status}: ${parsed?.error?.message || raw}`));
      });
    });
    req.on('error', reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Graph request timed out')));
    }
    if (body) req.write(body);
    req.end();
  });

const getToken = async (cfg) => {
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  }).toString();

  const data = await request(
    {
      host: LOGIN_HOST,
      path: `/${cfg.tenantId}/oauth2/v2.0/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form),
      },
      timeoutMs: cfg.timeoutMs,
    },
    form
  );
  return data.access_token;
};

const degraded = (ctx) => ({
  external_event_id: null,
  meeting_url: ctx.meetingUrl || null,
  location: ctx.location || null,
  provider_meta: { provider: key, degraded: true },
});

const createEvent = async (ctx) => {
  const cfg = calendarConfig.providers[key];
  if (!cfg.enabled || !cfg.organizerUserId) return degraded(ctx);

  try {
    const token = await getToken(cfg);
    const payload = JSON.stringify({
      startDateTime: ctx.start.toISOString(),
      endDateTime: ctx.end.toISOString(),
      subject: ctx.title,
    });
    const data = await request(
      {
        host: GRAPH_HOST,
        path: `/v1.0/users/${encodeURIComponent(cfg.organizerUserId)}/onlineMeetings`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeoutMs: cfg.timeoutMs,
      },
      payload
    );
    return {
      external_event_id: data.id || null,
      meeting_url: data.joinWebUrl || data.joinUrl || null,
      location: ctx.location || null,
      provider_meta: {
        provider: key,
        conference_id: data.videoTeleconferenceId || null,
        organizer: cfg.organizerUserId,
      },
    };
  } catch (err) {
    logger.error(`[calendar:teams] createEvent failed, degrading to manual: ${err.message}`);
    return degraded(ctx);
  }
};

/**
 * Graph online meetings don't carry an attendee list the same way; the simplest robust
 * behaviour is to re-issue a meeting on reschedule. If we already have an id we keep it.
 */
const updateEvent = async (ctx) => {
  if (!ctx.externalEventId) return createEvent(ctx);
  const cfg = calendarConfig.providers[key];
  // Preserve the existing join URL; time changes are communicated via the invite email.
  return {
    external_event_id: ctx.externalEventId,
    meeting_url: ctx.meetingUrl || null,
    location: ctx.location || null,
    provider_meta: { provider: key, organizer: cfg.organizerUserId },
  };
};

const cancelEvent = async (ctx) => {
  const cfg = calendarConfig.providers[key];
  if (!cfg.enabled || !ctx.externalEventId || !cfg.organizerUserId) return undefined;
  try {
    const token = await getToken(cfg);
    await request({
      host: GRAPH_HOST,
      path: `/v1.0/users/${encodeURIComponent(cfg.organizerUserId)}/onlineMeetings/${encodeURIComponent(
        ctx.externalEventId
      )}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: cfg.timeoutMs,
    });
  } catch (err) {
    logger.error(`[calendar:teams] cancelEvent failed: ${err.message}`);
  }
  return undefined;
};

module.exports = { key, isEnabled, createEvent, updateEvent, cancelEvent };
