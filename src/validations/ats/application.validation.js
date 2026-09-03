const Joi = require('joi');
const {
  APPLICATION_STATUSES,
  APPLICATION_NOTE_MAX_LENGTH,
  APPLICATION_DECISION_REASON_MAX_LENGTH,
  APPLICATION_RATING_MIN,
  APPLICATION_RATING_MAX,
  INTERVIEW_ROUND_KEY_MAX_LENGTH,
} = require('../../utils/ats.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the recruiter-facing Application endpoints (review + workflow).
 * Which applications a caller may see/act on is enforced in the service (own job vs
 * org-wide). These schemas only guard the request shape.
 */

// GET /jobs/:uuid/applications — applications for one job (paginated + filtered).
const listApplications = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(APPLICATION_STATUSES)),
        stage_key: Joi.string().max(INTERVIEW_ROUND_KEY_MAX_LENGTH),
      })
      .unknown(true),
  }),
};

// GET /jobs/:uuid/applications/ranked — top-N candidates by screening score.
const listRankedApplications = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(100),
  }),
};

const getApplication = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PATCH /applications/:uuid/status — move the application through its lifecycle.
 *   - stage_key is required when status === 'interviewing' (which round).
 *   - decision_reason is required when status === 'rejected'.
 * All transition legality is enforced in the service against APPLICATION_TRANSITIONS
 * and the parent job's interview_rounds.
 */
const changeApplicationStatus = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    status: Joi.string()
      .valid(...Object.values(APPLICATION_STATUSES))
      .required(),
    stage_key: Joi.string()
      .max(INTERVIEW_ROUND_KEY_MAX_LENGTH)
      .when('status', {
        is: APPLICATION_STATUSES.INTERVIEWING,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
    decision_reason: Joi.string()
      .trim()
      .max(APPLICATION_DECISION_REASON_MAX_LENGTH)
      .when('status', {
        is: APPLICATION_STATUSES.REJECTED,
        then: Joi.required(),
        otherwise: Joi.optional().allow('', null),
      }),
    note: Joi.string().trim().max(APPLICATION_NOTE_MAX_LENGTH).allow('', null),
  }),
};

/** PATCH /applications/:uuid/rating — set/update the candidate rating (1–5). */
const rateApplication = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    rating: Joi.number()
      .integer()
      .min(APPLICATION_RATING_MIN)
      .max(APPLICATION_RATING_MAX)
      .required(),
  }),
};

/** POST /applications/:uuid/notes — append an internal note (writes an event). */
const addApplicationNote = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    note: Joi.string().trim().min(1).max(APPLICATION_NOTE_MAX_LENGTH).required(),
  }),
};

const deleteApplication = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  listApplications,
  listRankedApplications,
  getApplication,
  changeApplicationStatus,
  rateApplication,
  addApplicationNote,
  deleteApplication,
};
