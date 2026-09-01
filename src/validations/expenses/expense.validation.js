const Joi = require('joi');
const path = require('path');
const {
  EXPENSE_STATUSES,
  EXPENSE_CATEGORIES,
  EXPENSE_CURRENCIES,
  EXPENSE_DEFAULT_CURRENCY,
  EXPENSE_AMOUNT_MIN,
  EXPENSE_AMOUNT_MAX,
  EXPENSE_ATTACHMENT_MAX_FILES,
  EXPENSE_ATTACHMENT_MAX_NAME_LENGTH,
  EXPENSE_ATTACHMENT_ALLOWED_EXTENSIONS,
} = require('../../utils/expense.constants');
const { listQuery } = require('../common.validation');

/**
 * A single attachment: for now only the file name is accepted/persisted.
 * The name must be non-empty, within length, and have an allowed extension.
 * Extra keys are stripped so clients can't smuggle unexpected fields into the JSON.
 */
const attachment = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(EXPENSE_ATTACHMENT_MAX_NAME_LENGTH)
    .custom((value, helpers) => {
      const ext = path.extname(value).toLowerCase();
      if (!EXPENSE_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'allowed extension')
    .required(),
}).unknown(false);

const attachmentsList = Joi.array()
  .items(attachment)
  .max(EXPENSE_ATTACHMENT_MAX_FILES)
  .default([]);

const amount = Joi.number()
  .precision(2)
  .min(EXPENSE_AMOUNT_MIN)
  .max(EXPENSE_AMOUNT_MAX);

// ISO date (YYYY-MM-DD) for the incurred date. Not allowed to be in the future.
const expenseDate = Joi.date().iso().max('now');

/**
 * POST /expenses — create an expense as a draft or submit it straight away.
 *
 * `action` mirrors the two buttons in the UI:
 *   - 'draft'  -> "Save as Draft"      (attachments optional, lighter validation)
 *   - 'submit' -> "Save and Submit"    (all required fields + at least one attachment)
 *
 * organization_id and created_by are derived from the token, never the body, so the
 * client cannot spoof tenant/owner. status is derived from `action`, never sent raw.
 */
const createExpense = {
  body: Joi.object()
    .keys({
      action: Joi.string().valid('draft', 'submit').default('draft'),
      title: Joi.string().trim().min(1).max(500).required(),
      category: Joi.string()
        .valid(...Object.values(EXPENSE_CATEGORIES))
        .required(),
      expense_date: expenseDate.required(),
      notes: Joi.string().trim().allow('').max(5000).optional(),
      amount: amount.required(),
      currency: Joi.string()
        .valid(...EXPENSE_CURRENCIES)
        .default(EXPENSE_DEFAULT_CURRENCY),
      attachments: attachmentsList,
    })
    // On submit, at least one attachment is required (UI marks Attachments* required).
    .when(Joi.object({ action: Joi.valid('submit') }).unknown(), {
      then: Joi.object({ attachments: Joi.array().items(attachment).min(1).max(EXPENSE_ATTACHMENT_MAX_FILES).required() }),
    }),
};

/**
 * GET /expenses — list with pagination/sort/search plus expense-specific filters.
 * Filters are allow-listed in EXPENSE_QUERY_CONFIG; anything else is ignored.
 */
const listExpenses = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(EXPENSE_STATUSES)),
        category: Joi.string().valid(...Object.values(EXPENSE_CATEGORIES)),
        currency: Joi.string().valid(...EXPENSE_CURRENCIES),
        created_at_from: Joi.string(),
        created_at_to: Joi.string(),
        expense_date_from: Joi.string(),
        expense_date_to: Joi.string(),
      })
      .unknown(true),
    // Convenience view selector: 'mine' (created by me).
    scope: Joi.string().valid('mine').optional(),
  }),
};

const getExpense = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PUT /expenses/:uuid — update a draft (or a rejected expense being revised).
 * Who may update which expense is enforced in the service (owner + editable status).
 * `action` optionally re-submits after editing.
 */
const updateExpense = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      action: Joi.string().valid('draft', 'submit').optional(),
      title: Joi.string().trim().min(1).max(500),
      category: Joi.string().valid(...Object.values(EXPENSE_CATEGORIES)),
      expense_date: expenseDate,
      notes: Joi.string().trim().allow('').max(5000),
      amount,
      currency: Joi.string().valid(...EXPENSE_CURRENCIES),
      attachments: attachmentsList,
    })
    .min(1),
};

/**
 * PATCH /expenses/:uuid/submit — move a draft/rejected expense to submitted.
 * No body needed; kept as an explicit action for the "Submit" flow.
 */
const submitExpense = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PATCH /expenses/:uuid/review — a reviewer approves or rejects a submitted expense.
 * Rejection requires a reason.
 */
const reviewExpense = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      decision: Joi.string().valid('approve', 'reject').required(),
      rejection_reason: Joi.string().trim().min(3).max(1000),
    })
    .when(Joi.object({ decision: Joi.valid('reject') }).unknown(), {
      then: Joi.object({ rejection_reason: Joi.required() }),
      otherwise: Joi.object({ rejection_reason: Joi.forbidden() }),
    }),
};

const deleteExpense = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  submitExpense,
  reviewExpense,
  deleteExpense,
};
