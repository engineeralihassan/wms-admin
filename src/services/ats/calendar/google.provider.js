const logger = require('../../../config/logger');
const { config: calendarConfig, isProviderEnabled } = require('../../../config/calendar');
const { INTERVIEW_PROVIDERS, INTERVIEW_MODES } = require('../../../utils/ats.constants');

/**
 * GoogleCalendarProvider — creates a Google Calendar event and (for video interviews) a
 * Google Meet link via `conferenceData`, then invites the panel + candidate as attendees.
 *
 * Integration is lazy + optional by design:
 *   - The `googleapis` SDK is require()d lazily inside a try/catch so the app boots even
 *     when the dependency isn't installed yet. Install it with `npm i googleapis` when
 *     you're ready to go live.
 *   - Auth uses the OAuth2 refresh-token flow (client id/secret/refresh token) or a
 *     service-account JSON, whichever is configured (see config/calendar.js).
 *
 * If the provider is not enabled/configured, callers should never reach here — the
 * registry falls back to manual — but we still guard defensively.
 */
const key = INTERVIEW_PROVIDERS.GOOGLE;

const isEnabled = () => isProviderEnabled(key);

/** Lazily build an authenticated googleapis calendar client. Returns null if unavailable. */
const getClient = () => {
  const cfg = calendarConfig.providers[key];
  let google;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    ({ google } = require('googleapis'));
  } catch (err) {
    logger.warn(
      '[calendar:google] googleapis is not installed — run `npm i googleapis` to enable Google Calendar. Falling back is handled by the registry.'
    );
    return null;
  }

  try {
    let auth;
    if (cfg.serviceAccountJson) {
      const credentials = JSON.parse(cfg.serviceAccountJson);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar.events'],
      });
    } else {
      const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
      oauth2.setCredentials({ refresh_token: cfg.refreshToken });
      auth = oauth2;
    }
    return google.calendar({ version: 'v3', auth });
  } catch (err) {
    logger.error(`[calendar:google] failed to build client: ${err.message}`);
    return null;
  }
};

/** Map our interview context to a Google Calendar event resource. */
const toEventResource = (ctx) => {
  const attendees = (ctx.attendees || []).map((a) => ({ email: a.email, displayName: a.name }));
  const resource = {
    summary: ctx.title,
    description: ctx.description || undefined,
    start: { dateTime: ctx.start.toISOString(), timeZone: ctx.timezone },
    end: { dateTime: ctx.end.toISOString(), timeZone: ctx.timezone },
    attendees,
  };
  if (ctx.mode === INTERVIEW_MODES.ONSITE && ctx.location) {
    resource.location = ctx.location;
  }
  // Request a Meet link only for video interviews.
  if (ctx.mode === INTERVIEW_MODES.VIDEO) {
    resource.conferenceData = {
      createRequest: {
        requestId: ctx.idempotencyKey,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  return resource;
};

const extractResult = (data) => {
  const meetingUrl =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    null;
  return {
    external_event_id: data.id || null,
    meeting_url: meetingUrl,
    location: data.location || null,
    provider_meta: {
      provider: key,
      html_link: data.htmlLink || null,
      conference_id: data.conferenceData?.conferenceId || null,
      calendar_id: calendarConfig.providers[key].calendarId,
    },
  };
};

const createEvent = async (ctx) => {
  const client = getClient();
  if (!client) {
    // Degrade gracefully: behave like manual so the booking still succeeds.
    return {
      external_event_id: null,
      meeting_url: ctx.meetingUrl || null,
      location: ctx.location || null,
      provider_meta: { provider: key, degraded: true },
    };
  }
  const cfg = calendarConfig.providers[key];
  const { data } = await client.events.insert({
    calendarId: cfg.calendarId,
    conferenceDataVersion: ctx.mode === INTERVIEW_MODES.VIDEO ? 1 : 0,
    sendUpdates: 'all',
    requestBody: toEventResource(ctx),
  });
  return extractResult(data);
};

const updateEvent = async (ctx) => {
  const client = getClient();
  if (!client || !ctx.externalEventId) {
    return createEvent(ctx);
  }
  const cfg = calendarConfig.providers[key];
  const { data } = await client.events.patch({
    calendarId: cfg.calendarId,
    eventId: ctx.externalEventId,
    conferenceDataVersion: ctx.mode === INTERVIEW_MODES.VIDEO ? 1 : 0,
    sendUpdates: 'all',
    requestBody: toEventResource(ctx),
  });
  return extractResult(data);
};

const cancelEvent = async (ctx) => {
  const client = getClient();
  if (!client || !ctx.externalEventId) return undefined;
  const cfg = calendarConfig.providers[key];
  await client.events.delete({
    calendarId: cfg.calendarId,
    eventId: ctx.externalEventId,
    sendUpdates: 'all',
  });
  return undefined;
};

module.exports = { key, isEnabled, createEvent, updateEvent, cancelEvent };
