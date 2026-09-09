const Joi = require('joi');
const {
  INTERVIEW_MODES,
  INTERVIEW_PROVIDERS,
  INTERVIEW_LIMITS,
  INTERVIEW_ROUND_KEY_MAX_LENGTH,
} = require('../../utils/ats.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the recruiter-facing Interview endpoints. Visibility (which
 * application/interview a caller may touch) is enforced in the service; these schemas
 * only guard request shape. Business rules (transition legality, slot conflicts, stage
 * validity against the job pipeline) live in the service too.
 */

const uuid = Joi.string().uuid();
const interviewerUuids = Joi.array()
  .items(uuid.required())
  .min(INTERVIEW_LIMITS.MIN_INTERVIEWERS)
  .max(INTERVIEW_LIMITS.MAX_INTERVIEWERS)
  .unique();
const duration = Joi.number()
  .integer()
  .min(INTERVIEW_LIMITS.MIN_DURATION_MINUTES)
  .max(INTERVIEW_LIMITS.MAX_DURATION_MINUTES);
const timezone = Joi.string().max(INTERVIEW_LIMITS.TIMEZONE_MAX_LENGTH);

// Accept interviewer uuids as an array, a single uuid, OR a comma-separated string
// (the latter is what the web GET client sends), normalizing all to a string[].
const interviewerUuidsQuery = Joi.alternatives()
  .try(
    interviewerUuids,
    uuid,
    Joi.string().custom((value, helpers) => {
      const parts = String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return helpers.error('any.required');
      const schema = Joi.array().items(Joi.string().uuid().required());
      const { error, value: validated } = schema.validate(parts);
      if (error) return helpers.error('string.guid');
      return validated;
    })
  )
  .required()
  .custom((value) => (Array.isArray(value) ? value : [value]));

// GET /applications/:uuid/interviews/availability
const getAvailability = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  query: Joi.object().keys({
    date_from: Joi.date().iso().required(),
    date_to: Joi.date().iso().greater(Joi.ref('date_from')).required(),
    duration_minutes: duration,
    timezone: timezone.required(),
    interviewer_uuids: interviewerUuidsQuery,
  }),
};

// GET /applications/:uuid/interviewers — org users offered as interviewer options.
const listInterviewers = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  query: Joi.object().keys(listQuery),
};

// GET /applications/:uuid/interviews
const listInterviews = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string(),
        mode: Joi.string().valid(...Object.values(INTERVIEW_MODES)),
        provider: Joi.string().valid(...Object.values(INTERVIEW_PROVIDERS)),
        stage_key: Joi.string().max(INTERVIEW_ROUND_KEY_MAX_LENGTH),
      })
      .unknown(true),
  }),
};

// POST /applications/:uuid/interviews
const scheduleInterview = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  body: Joi.object().keys({
    stage_key: Joi.string().max(INTERVIEW_ROUND_KEY_MAX_LENGTH).required(),
    start: Joi.date().iso().required(),
    duration_minutes: duration,
    timezone: timezone.required(),
    mode: Joi.string().valid(...Object.values(INTERVIEW_MODES)).default(INTERVIEW_MODES.VIDEO),
    provider: Joi.string().valid(...Object.values(INTERVIEW_PROVIDERS)),
    interviewer_uuids: interviewerUuids.required(),
    // meeting_url is required for a manual video interview (no provider mints one).
    meeting_url: Joi.string()
      .uri()
      .max(INTERVIEW_LIMITS.MEETING_URL_MAX_LENGTH)
      .when('mode', {
        is: INTERVIEW_MODES.VIDEO,
        then: Joi.when('provider', {
          is: INTERVIEW_PROVIDERS.MANUAL,
          then: Joi.required(),
          otherwise: Joi.optional().allow('', null),
        }),
        otherwise: Joi.optional().allow('', null),
      }),
    // location is required for an onsite interview.
    location: Joi.string()
      .max(INTERVIEW_LIMITS.LOCATION_MAX_LENGTH)
      .when('mode', {
        is: INTERVIEW_MODES.ONSITE,
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
      }),
    title: Joi.string().max(INTERVIEW_LIMITS.TITLE_MAX_LENGTH).allow('', null),
    notes: Joi.string().max(INTERVIEW_LIMITS.NOTES_MAX_LENGTH).allow('', null),
  }),
};

const getInterview = {
  params: Joi.object().keys({ uuid: uuid.required() }),
};

// PATCH /interviews/:uuid/reschedule
const rescheduleInterview = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  body: Joi.object().keys({
    start: Joi.date().iso().required(),
    duration_minutes: duration,
    timezone,
    meeting_url: Joi.string().uri().max(INTERVIEW_LIMITS.MEETING_URL_MAX_LENGTH).allow('', null),
    location: Joi.string().max(INTERVIEW_LIMITS.LOCATION_MAX_LENGTH).allow('', null),
  }),
};

// PATCH /interviews/:uuid/cancel
const cancelInterview = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  body: Joi.object().keys({
    reason: Joi.string().max(INTERVIEW_LIMITS.NOTES_MAX_LENGTH).allow('', null),
  }),
};

// PATCH /interviews/:uuid/complete
const completeInterview = {
  params: Joi.object().keys({ uuid: uuid.required() }),
  body: Joi.object().keys({
    outcome: Joi.string().valid('completed', 'no_show').default('completed'),
    outcome_note: Joi.string().max(INTERVIEW_LIMITS.NOTES_MAX_LENGTH).allow('', null),
  }),
};

module.exports = {
  listInterviewers,
  getAvailability,
  listInterviews,
  scheduleInterview,
  getInterview,
  rescheduleInterview,
  cancelInterview,
  completeInterview,
};
