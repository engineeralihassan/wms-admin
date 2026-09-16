const Joi = require('joi');
const path = require('path');
const {
  LEAVE_STATUSES,
  LEAVE_DAY_PORTIONS,
  LEAVE_DECISIONS,
  LEAVE_REASON_MAX_LENGTH,
  LEAVE_REJECTION_REASON_MAX_LENGTH,
  LEAVE_ATTACHMENT_MAX_FILES,
  LEAVE_ATTACHMENT_MAX_NAME_LENGTH,
  LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS,
} = require('../../utils/leave.constants');
const { listQuery } = require('../common.validation');

/**
 * A single attachment: for now only the file name is accepted/persisted. The name
 * must be non-empty, within length, and have an allowed extension. Extra keys are
 * stripped so clients can't smuggle unexpected fields into the JSON.
 */
const attachment = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(LEAVE_ATTACHMENT_MAX_NAME_LENGTH)
    .custom((value, helpers) => {
      const ext = path.extname(value).toLowerCase();
      if (!LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'allowed extension')
    .required(),
}).unknown(false);

const attachmentsList = Joi.array()
  .items(attachment)
  .max(LEAVE_ATTACHMENT_MAX_FILES)
  .default([]);

// ISO date (YYYY-MM-DD). Range/past-date rules are enforced in the service where the
// organization's "today" is known.
const dateOnly = Joi.date().iso();

/**
 * POST /leaves — create a leave request (draft, or submit immediately via action).
 * organization_id and created_by are derived from the token, never the body.
 */
const createLeave = {
  body: Joi.object().keys({
    leave_type: Joi.string().uuid().required(),
    start_date: dateOnly.required(),
    end_date: dateOnly.required(),
    day_portion: Joi.string()
      .valid(...Object.values(LEAVE_DAY_PORTIONS))
      .default(LEAVE_DAY_PORTIONS.FULL),
    reason: Joi.string().trim().max(LEAVE_REASON_MAX_LENGTH).allow('', null),
    attachments: attachmentsList,
    // 'draft' (default) or 'submit' to apply immediately.
    action: Joi.string().valid('draft', 'submit').default('draft'),
  }),
};

/**
 * GET /leaves — list with pagination/sort/search plus leave-specific filters.
 * Filters are allow-listed in LEAVE_QUERY_CONFIG; anything else is ignored.
 */
const listLeaves = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(LEAVE_STATUSES)),
        // Filter by leave type using its public uuid (resolved to id in the service).
        leave_type: Joi.string().uuid(),
        day_portion: Joi.string().valid(...Object.values(LEAVE_DAY_PORTIONS)),
        start_date_from: Joi.string(),
        start_date_to: Joi.string(),
      })
      .unknown(true),
    // Convenience view selector: 'mine' (created by me).
    scope: Joi.string().valid('mine').optional(),
  }),
};

const getLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PUT /leaves/:uuid — edit a draft/rejected request. Optional action:'submit'
 * re-applies after editing. Who may edit is enforced in the service (owner only).
 */
const updateLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      leave_type: Joi.string().uuid(),
      start_date: dateOnly,
      end_date: dateOnly,
      day_portion: Joi.string().valid(...Object.values(LEAVE_DAY_PORTIONS)),
      reason: Joi.string().trim().max(LEAVE_REASON_MAX_LENGTH).allow('', null),
      attachments: attachmentsList,
      action: Joi.string().valid('draft', 'submit'),
    })
    .min(1),
};

const submitLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

const withdrawLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PATCH /leaves/:uuid/decision — approve or reject a submitted request.
 * rejection_reason is required when decision === 'reject'.
 */
const decideLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string()
      .valid(...Object.values(LEAVE_DECISIONS))
      .required(),
    rejection_reason: Joi.string()
      .trim()
      .max(LEAVE_REJECTION_REASON_MAX_LENGTH)
      .when('decision', {
        is: LEAVE_DECISIONS.REJECT,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
  }),
};

const cancelLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

const deleteLeave = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * POST/GET /leaves/:uuid/attachments — real file upload/list. File type/size/count are
 * enforced by multer (see config/storage); here we only validate the route param.
 */
const leaveAttachments = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** DELETE /leaves/:uuid/attachments/:attachmentUuid — remove one uploaded file. */
const deleteLeaveAttachment = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
    attachmentUuid: Joi.string().uuid().required(),
  }),
};

/**
 * GET /leaves/calendar — timesheet-facing read of leave days in a range.
 * `user` (uuid) is optional; approvers may query others, normal users only self.
 */
const leaveCalendar = {
  query: Joi.object().keys({
    from: dateOnly.required(),
    to: dateOnly.required(),
    user: Joi.string().uuid().optional(),
    include_pending: Joi.boolean().default(false),
  }),
};

const myBalances = {
  query: Joi.object().keys({
    period_year: Joi.number().integer().min(2000).max(2100),
  }),
};

// ── Leave type admin (leave.allocate) ───────────────────────────────────────

const listLeaveTypes = {
  query: Joi.object().keys({
    include_inactive: Joi.boolean().default(false),
  }),
};

const createLeaveType = {
  body: Joi.object().keys({
    key: Joi.string().trim().lowercase().min(1).max(50).required(),
    name: Joi.string().trim().min(1).max(100).required(),
    is_paid: Joi.boolean().default(true),
    requires_balance: Joi.boolean(),
    color: Joi.string().trim().max(9).allow('', null),
    is_active: Joi.boolean().default(true),
  }),
};

const updateLeaveType = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(100),
      is_paid: Joi.boolean(),
      requires_balance: Joi.boolean(),
      color: Joi.string().trim().max(9).allow('', null),
      is_active: Joi.boolean(),
    })
    .min(1),
};

// ── Balance admin (leave.allocate) ──────────────────────────────────────────

const listBalances = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        leave_type_id: Joi.number().integer(),
        period_year: Joi.number().integer(),
        user_id: Joi.number().integer(),
      })
      .unknown(true),
    user: Joi.string().uuid().optional(),
  }),
};

/**
 * POST /leaves/balances — allocate/set a user's balance for a type + year.
 * Idempotent upsert semantics handled in the service (adjusts `allocated`).
 */
const allocateBalance = {
  body: Joi.object().keys({
    user: Joi.string().uuid().required(),
    leave_type: Joi.string().uuid().required(),
    period_year: Joi.number().integer().min(2000).max(2100).required(),
    allocated: Joi.number().min(0).precision(2).required(),
  }),
};

module.exports = {
  createLeave,
  listLeaves,
  getLeave,
  updateLeave,
  submitLeave,
  withdrawLeave,
  decideLeave,
  cancelLeave,
  deleteLeave,
  leaveAttachments,
  deleteLeaveAttachment,
  leaveCalendar,
  myBalances,
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  listBalances,
  allocateBalance,
};
