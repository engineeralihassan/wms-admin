const Joi = require('joi');
const {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  RELATED_TYPES,
  ACTIVITY_SUBJECT_MAX_LENGTH,
  ACTIVITY_BODY_MAX_LENGTH,
} = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Activity endpoints. The polymorphic parent is referenced by
 * related_type + related_uuid and resolved (scoped) in the service. owner is always the
 * creator. Task-type activities may carry a due date; the service applies the lifecycle.
 */

const relatedType = Joi.string().valid(...Object.values(RELATED_TYPES));

/** POST /sales/activities — log/create against a parent record. */
const createActivity = {
  body: Joi.object().keys({
    related_type: relatedType.required(),
    related_uuid: Joi.string().uuid().required(),
    activity_type: Joi.string().valid(...Object.values(ACTIVITY_TYPES)).required(),
    subject: Joi.string().trim().min(1).max(ACTIVITY_SUBJECT_MAX_LENGTH).required(),
    body: Joi.string().trim().max(ACTIVITY_BODY_MAX_LENGTH).allow('', null),
    due_at: Joi.date().iso().allow(null),
  }),
};

/** GET /sales/:relatedType/:relatedUuid/activities — a record's timeline. */
const listForRecord = {
  params: Joi.object().keys({
    relatedType: relatedType.required(),
    relatedUuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        activity_type: Joi.string().valid(...Object.values(ACTIVITY_TYPES)),
        status: Joi.string().valid(...Object.values(ACTIVITY_STATUSES)),
      })
      .unknown(true),
  }),
};

/** GET /sales/activities/my-tasks. */
const myTasks = {
  query: Joi.object().keys({
    ...listQuery,
    overdue: Joi.boolean(),
  }),
};

const getActivity = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updateActivity = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object()
    .keys({
      subject: Joi.string().trim().min(1).max(ACTIVITY_SUBJECT_MAX_LENGTH),
      body: Joi.string().trim().max(ACTIVITY_BODY_MAX_LENGTH).allow('', null),
      due_at: Joi.date().iso().allow(null),
    })
    .min(1),
};

const activityAction = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createActivity,
  listForRecord,
  myTasks,
  getActivity,
  updateActivity,
  completeActivity: activityAction,
  cancelActivity: activityAction,
  deleteActivity: activityAction,
};
