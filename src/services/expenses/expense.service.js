const httpStatus = require('http-status');
const { sequelize, Expense, User, Organization } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { EXPENSE_QUERY_CONFIG } = require('../../config/query-configs');
const { EXPENSE_STATUSES } = require('../../utils/expense.constants');

/** Columns returned for expense list/detail. */
const EXPENSE_ATTRIBUTES = [
  'id',
  'uuid',
  'expense_number',
  'organization_id',
  'created_by_id',
  'reviewed_by_id',
  'title',
  'category',
  'expense_date',
  'notes',
  'amount',
  'currency',
  'status',
  'attachments',
  'submitted_at',
  'reviewed_at',
  'rejection_reason',
  'createdAt',
  'updatedAt',
];

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];

/** Associations loaded with an expense so the API can show who created/reviewed it. */
const EXPENSE_INCLUDE = [
  { model: User, as: 'creator', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: User, as: 'reviewer', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
];

/**
 * Single source of truth for "does this actor review expenses org-wide".
 *
 * The capability that separates an org-level reviewer (Org Admin) from a normal
 * claimant is expense.review: reviewers can see ALL of their org's expenses and
 * approve/reject submitted ones. We check the PERMISSION (not the role name) so any
 * custom role granted expense.review behaves the same way.
 */
const isReviewer = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.EXPENSE_REVIEW);

/**
 * Builds the tenant + visibility where-clause for expense LIST/READ queries.
 *
 * Visibility rules:
 *   super_admin  -> {}                                (all expenses, all orgs)
 *   reviewer     -> { organization_id }               (all expenses in their org)
 *   normal user  -> { organization_id, created_by_id = me }
 *                   (only expenses they own — including their own drafts)
 *
 * FAIL-CLOSED: requires the request to have passed through the `tenantScope`
 * middleware. If it hasn't, this throws instead of silently returning unscoped data.
 * Org and user ids come from the signed token, never the request body.
 */
const buildExpenseScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }

  const scope = { ...tenantWhere };
  if (!isReviewer(auth)) {
    // Normal user: only their own expenses (drafts included).
    scope.created_by_id = auth.userId;
  }
  return scope;
};

/**
 * Generate the next human-friendly expense number ("EXP-000123").
 * Derived from the current max id inside a transaction so it stays monotonic; the
 * expense_number unique constraint is the ultimate guard against collisions.
 */
const nextExpenseNumber = async (transaction) => {
  const maxId = (await Expense.max('id', { transaction })) || 0;
  return `EXP-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

/** Normalize attachment metadata so only { name } is persisted. */
const normalizeAttachments = (attachments) =>
  Array.isArray(attachments) ? attachments.map((a) => ({ name: String(a.name).trim() })) : [];

/**
 * Load an expense by uuid within the caller's VISIBILITY scope. Returns null if the
 * caller cannot see it (so callers can turn that into a 404, never leaking existence).
 */
const findVisibleExpense = async (uuid, req) =>
  Expense.findOne({
    where: { uuid, ...buildExpenseScope(req) },
    attributes: EXPENSE_ATTRIBUTES,
    include: EXPENSE_INCLUDE,
  });

/**
 * Create an expense as a draft or submit it immediately.
 * organization_id + created_by_id come from the token. status derives from `action`.
 */
const createExpense = async (body, req, res) => {
  const { auth } = req;
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  const action = body.action === 'submit' ? 'submit' : 'draft';
  const status = action === 'submit' ? EXPENSE_STATUSES.SUBMITTED : EXPENSE_STATUSES.DRAFT;

  const expense = await sequelize.transaction(async (transaction) => {
    const expense_number = await nextExpenseNumber(transaction);
    return Expense.create(
      {
        expense_number,
        organization_id: organizationId,
        created_by_id: auth.userId,
        title: body.title,
        category: body.category,
        expense_date: body.expense_date,
        notes: body.notes ?? null,
        amount: body.amount,
        currency: body.currency,
        attachments: normalizeAttachments(body.attachments),
        status,
        submitted_at: status === EXPENSE_STATUSES.SUBMITTED ? new Date() : null,
      },
      { transaction }
    );
  });

  return findVisibleExpense(expense.uuid, req);
};

/**
 * List expenses visible to the caller with search/sort/filter/pagination.
 * `scope=mine` narrows to the caller's own expenses on top of base visibility
 * (useful for a reviewer who wants to see just their own claims).
 */
const listExpenses = async (req) => {
  const scopeWhere = buildExpenseScope(req);

  if (req.query.scope === 'mine') {
    scopeWhere.created_by_id = req.auth.userId;
  }

  return paginate(Expense, req.query, EXPENSE_QUERY_CONFIG, {
    scopeWhere,
    attributes: EXPENSE_ATTRIBUTES,
    include: EXPENSE_INCLUDE,
  });
};

/** Fetch one expense by uuid, visibility-scoped. */
const getExpenseByUuid = async (uuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }
  return expense;
};

/** An expense is editable by its owner only while it's a draft or was rejected. */
const isOwnerEditable = (expense) =>
  expense.status === EXPENSE_STATUSES.DRAFT || expense.status === EXPENSE_STATUSES.REJECTED;

/**
 * Update an expense's content.
 *   - Only the OWNER may edit, and only while the expense is a draft or rejected
 *     (a submitted/approved expense is locked from content edits).
 *   - Reviewers do NOT edit claim content; they approve/reject. This keeps an audit
 *     boundary between "who wrote the claim" and "who approved it".
 *   - Optional `action:'submit'` re-submits after editing.
 */
const updateExpense = async (uuid, body, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }

  // Only the owner may edit content.
  if (expense.created_by_id !== req.auth.userId) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  if (!isOwnerEditable(expense)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_not_editable'));
  }

  const updatable = ['title', 'category', 'expense_date', 'notes', 'amount', 'currency'];
  updatable.forEach((field) => {
    if (body[field] !== undefined) expense[field] = body[field];
  });
  if (body.attachments !== undefined) {
    expense.attachments = normalizeAttachments(body.attachments);
  }

  // Re-submitting after a rejection/draft edit clears the prior review verdict.
  if (body.action === 'submit') {
    if ((expense.attachments || []).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_attachment_required'));
    }
    expense.status = EXPENSE_STATUSES.SUBMITTED;
    expense.submitted_at = new Date();
    expense.reviewed_by_id = null;
    expense.reviewed_at = null;
    expense.rejection_reason = null;
  }

  await expense.save();
  return findVisibleExpense(uuid, req);
};

/**
 * Submit a draft/rejected expense for approval (explicit action endpoint).
 * Owner-only; requires at least one attachment (parity with the create-submit rule).
 */
const submitExpense = async (uuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }
  if (expense.created_by_id !== req.auth.userId) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  if (!isOwnerEditable(expense)) {
    // Already submitted or approved — nothing to submit.
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_not_submittable'));
  }
  if ((expense.attachments || []).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_attachment_required'));
  }

  expense.status = EXPENSE_STATUSES.SUBMITTED;
  expense.submitted_at = new Date();
  expense.reviewed_by_id = null;
  expense.reviewed_at = null;
  expense.rejection_reason = null;
  await expense.save();

  return findVisibleExpense(uuid, req);
};

/**
 * Approve or reject a SUBMITTED expense. Reviewer-only (expense.review).
 * The route already gates on expense.review; we re-check defensively and enforce that
 * only submitted expenses can be decided. Rejection stores the reason.
 */
const reviewExpense = async (uuid, decision, rejectionReason, req, res) => {
  if (!isReviewer(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }

  // A reviewer cannot decide their own claim — separation of duties.
  if (expense.created_by_id === req.auth.userId) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('expense_self_review'));
  }
  if (expense.status !== EXPENSE_STATUSES.SUBMITTED) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_not_reviewable'));
  }

  if (decision === 'approve') {
    expense.status = EXPENSE_STATUSES.APPROVED;
    expense.rejection_reason = null;
  } else {
    expense.status = EXPENSE_STATUSES.REJECTED;
    expense.rejection_reason = rejectionReason;
  }
  expense.reviewed_by_id = req.auth.userId;
  expense.reviewed_at = new Date();
  await expense.save();

  return findVisibleExpense(uuid, req);
};

/**
 * Delete an expense. Gated by expense.delete at the route.
 *   - Owner may delete their OWN expense while it's a draft or rejected (not once it's
 *     submitted/approved — those are part of the financial record).
 *   - Reviewers may delete any visible expense in their org (admin cleanup).
 * Always visibility-scoped so no cross-org deletes are possible.
 */
const deleteExpense = async (uuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }

  const reviewer = isReviewer(req.auth);
  const isOwner = expense.created_by_id === req.auth.userId;

  if (!reviewer) {
    if (!isOwner) {
      throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
    }
    if (!isOwnerEditable(expense)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('expense_not_deletable'));
    }
  }

  await expense.destroy();
  return true;
};

module.exports = {
  createExpense,
  listExpenses,
  getExpenseByUuid,
  updateExpense,
  submitExpense,
  reviewExpense,
  deleteExpense,
  buildExpenseScope,
  isReviewer,
};
