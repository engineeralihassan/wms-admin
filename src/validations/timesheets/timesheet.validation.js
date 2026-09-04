const Joi = require('joi');
const {
  TIMESHEET_STATUSES,
  TIMESHEET_DECISIONS,
  HOURS_MIN,
  HOURS_MAX,
  DAYS_IN_WEEK,
} = require('../../utils/timesheet.constants');
const { listQuery } = require('../common.validation');

// ISO date (YYYY-MM-DD).
const isoDate = Joi.date().iso();

/** A single day's entry in a save/correction payload. */
const entry = Joi.object({
  work_date: isoDate.required(),
  hours: Joi.number().precision(2).min(HOURS_MIN).max(HOURS_MAX),
  note: Joi.string().trim().allow('', null).max(1000),
})
  .or('hours', 'note')
  .unknown(false);

// At most 7 entries (one per day of the week); the service also validates each date
// falls within the sheet's own week.
const entriesList = Joi.array().items(entry).min(1).max(DAYS_IN_WEEK);

/**
 * POST /timesheets — open (ensure) the current (or a chosen) week's timesheet for a
 * project. organization_id + owner come from the token. `project` is the project's
 * public uuid; `week_date` optionally targets a specific week (any date within it).
 */
const createTimesheet = {
  body: Joi.object().keys({
    project: Joi.string().uuid().required(),
    week_date: isoDate.optional(),
  }),
};

/**
 * GET /timesheets — list with pagination/sort/search plus timesheet-specific filters.
 * Filters are allow-listed in TIMESHEET_QUERY_CONFIG; the project filter is a uuid the
 * service resolves to an id.
 */
const listTimesheets = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(TIMESHEET_STATUSES)),
        project_id: Joi.string().uuid(),
        created_at_from: Joi.string(),
        created_at_to: Joi.string(),
        week_start_date_from: Joi.string(),
        week_start_date_to: Joi.string(),
        due_date_from: Joi.string(),
        due_date_to: Joi.string(),
      })
      .unknown(true),
    scope: Joi.string().valid('mine').optional(),
  }),
};

const getTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** PATCH /timesheets/:uuid/entries — owner bulk-saves the week's daily hours/notes. */
const saveEntries = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    entries: entriesList.required(),
  }),
};

/** POST /timesheets/:uuid/submit — owner submits (no body). */
const submitTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** POST /timesheets/:uuid/withdraw — owner withdraws a submitted sheet (no body). */
const withdrawTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * POST /timesheets/:uuid/review — approver approves or rejects a submitted sheet.
 * Rejection requires a reason; an optional review note is allowed on either decision.
 */
const reviewTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      decision: Joi.string()
        .valid(...Object.values(TIMESHEET_DECISIONS))
        .required(),
      rejection_reason: Joi.string().trim().min(3).max(1000),
      review_note: Joi.string().trim().allow('', null).max(1000),
    })
    .when(Joi.object({ decision: Joi.valid(TIMESHEET_DECISIONS.REJECT) }).unknown(), {
      then: Joi.object({ rejection_reason: Joi.required() }),
      otherwise: Joi.object({ rejection_reason: Joi.forbidden() }),
    }),
};

/**
 * PATCH /timesheets/:uuid — approver correction: edit daily entries and/or move the
 * status (accept a backfilled/locked sheet), with an explanatory note. At least one of
 * entries / status / review_note must be present.
 */
const correctTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      entries: entriesList,
      status: Joi.string().valid(TIMESHEET_STATUSES.SUBMITTED, TIMESHEET_STATUSES.APPROVED),
      review_note: Joi.string().trim().allow('', null).max(1000),
    })
    .min(1),
};

const deleteTimesheet = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** GET /timesheets/projects — project picker (reuses the list query shape). */
const listProjects = {
  query: Joi.object().keys({
    ...listQuery,
  }),
};

module.exports = {
  createTimesheet,
  listTimesheets,
  getTimesheet,
  saveEntries,
  submitTimesheet,
  withdrawTimesheet,
  reviewTimesheet,
  correctTimesheet,
  deleteTimesheet,
  listProjects,
};
