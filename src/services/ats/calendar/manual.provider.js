const { INTERVIEW_PROVIDERS } = require('../../../utils/ats.constants');

/**
 * ManualProvider — the always-available fallback.
 *
 * It performs no third-party calls. The recruiter supplies the meeting link (for a
 * video interview run on any tool they like) or the location (onsite/phone). We simply
 * echo those back so the interview record and the invite emails carry them.
 *
 * This is what guarantees the scheduling feature is fully functional before Google/
 * Teams credentials exist. Every provider implements the same contract:
 *
 *   createEvent(ctx) -> { external_event_id, meeting_url, location, provider_meta }
 *   updateEvent(ctx) -> same shape
 *   cancelEvent(ctx) -> void
 */
const key = INTERVIEW_PROVIDERS.MANUAL;

const createEvent = async (ctx) => ({
  external_event_id: null,
  meeting_url: ctx.meetingUrl || null,
  location: ctx.location || null,
  provider_meta: { provider: key, mode: 'manual' },
});

const updateEvent = async (ctx) => createEvent(ctx);

// Nothing to cancel externally.
const cancelEvent = async () => undefined;

module.exports = {
  key,
  isEnabled: () => true,
  createEvent,
  updateEvent,
  cancelEvent,
};
