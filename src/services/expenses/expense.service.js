const httpStatus = require('http-status');
const { sequelize, Expense, User, Organization, Attachment } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { EXPENSE_QUERY_CONFIG } = require('../../config/query-configs');
const { EXPENSE_STATUSES } = require('../../utils/expense.constants');
const attachmentService = require('../storage/attachment.service');
const { UPLOAD_FOLDERS } = require('../../config/storage');

/** owner_type used to key expense files in the polymorphic attachments table. */
const EXPENSE_OWNER_TYPE = 'expense';

/**
 * Count the REAL uploaded attachment rows for an expense (the ones backed by bytes in
 * object storage), used to enforce the "submit needs an attachment" rule. This replaces
 * the older count of the name-only JSONB array now that files are actually uploaded.
 */
const countExpenseAttachments = (expenseId) =>
  Attachment.count({ where: { owner_type: EXPENSE_OWNER_TYPE, owner_id: expenseId } });

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
 * Attach the real uploaded-file rows (polymorphic attachments) onto expense
 * instances as `expense_attachments`, batched by a single query. Because attachments
 * are polymorphic (no Sequelize association), we load them here rather than via
 * `include`. Mutates and returns the same instances for convenience.
 */
const withAttachments = async (expenses) => {
  const list = Array.isArray(expenses) ? expenses : [expenses].filter(Boolean);
  if (list.length === 0) return expenses;

  const ids = list.map((e) => e.id);
  const rows = await Attachment.findAll({
    where: { owner_type: EXPENSE_OWNER_TYPE, owner_id: ids },
    order: [['created_at', 'DESC']],
  });

  const byOwner = new Map();
  rows.forEach((r) => {
    const arr = byOwner.get(r.owner_id) || [];
    arr.push(attachmentService.toDto(r));
    byOwner.set(r.owner_id, arr);
  });

  list.forEach((e) => {
    // setDataValue so the extra field survives toJSON/serialization.
    e.setDataValue('expense_attachments', byOwner.get(e.id) || []);
  });
  return expenses;
};

/**
 * Load an expense by uuid within the caller's VISIBILITY scope. Returns null if the
 * caller cannot see it (so callers can turn that into a 404, never leaking existence).
 */
const findVisibleExpense = async (uuid, req) => {
  const expense = await Expense.findOne({
    where: { uuid, ...buildExpenseScope(req) },
    attributes: EXPENSE_ATTRIBUTES,
    include: EXPENSE_INCLUDE,
  });
  if (expense) await withAttachments(expense);
  return expense;
};

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

  // A new expense is always created as a DRAFT: files are uploaded AFTER it exists
  // (they need the expense id as their owner), and submitting requires >=1 uploaded
  // file. The frontend flow is therefore: create (draft) -> upload files -> submit.
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
        status: EXPENSE_STATUSES.DRAFT,
        submitted_at: null,
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

  const result = await paginate(Expense, req.query, EXPENSE_QUERY_CONFIG, {
    scopeWhere,
    attributes: EXPENSE_ATTRIBUTES,
    include: EXPENSE_INCLUDE,
  });

  // Batch-load real uploaded attachments onto the page of rows (one extra query).
  await withAttachments(result.data);
  return result;
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
    // Require at least one REAL uploaded attachment (bytes in storage), not just a name.
    if ((await countExpenseAttachments(expense.id)) === 0) {
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
  if ((await countExpenseAttachments(expense.id)) === 0) {
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

// ── Attachments (real files, backed by the polymorphic attachments table) ────────
//
// These sit on top of the generic attachment.service. The expense is always resolved
// WITHIN the caller's visibility scope first, so owner_id is derived server-side and
// never trusted from the client. Uploading is an owner action on an editable expense;
// listing follows read visibility; deleting follows the same owner/editable rule.

/** True when the caller may add/remove files on this expense (owner + draft/rejected). */
const canModifyAttachments = (expense, auth) =>
  expense.created_by_id === auth.userId && isOwnerEditable(expense);

/**
 * Upload one or more files to an expense (multipart already parsed onto req).
 * Owner-only, and only while the expense is a draft or rejected.
 */
const uploadExpenseAttachments = async (uuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }
  if (!canModifyAttachments(expense, req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  return attachmentService.uploadAndPersist(req, {
    ownerType: EXPENSE_OWNER_TYPE,
    ownerId: expense.id,
    organizationId: expense.organization_id,
    uploadedById: req.auth.userId,
    folder: UPLOAD_FOLDERS.EXPENSES,
  });
};

/** List an expense's uploaded files. Follows read visibility. */
const listExpenseAttachments = async (uuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }
  return attachmentService.listForOwner(EXPENSE_OWNER_TYPE, expense.id, req.tenantWhere);
};

/**
 * Delete one uploaded file from an expense. Owner-only + draft/rejected, and the
 * attachment must actually belong to that expense (guards against cross-expense uuids).
 */
const deleteExpenseAttachment = async (uuid, attachmentUuid, req, res) => {
  const expense = await findVisibleExpense(uuid, req);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('expense_not_found'));
  }
  if (!canModifyAttachments(expense, req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  const row = await Attachment.findOne({
    where: {
      uuid: attachmentUuid,
      owner_type: EXPENSE_OWNER_TYPE,
      owner_id: expense.id,
      ...req.tenantWhere,
    },
  });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('file_not_found'));
  }
  await attachmentService.deleteByUuid(attachmentUuid, req.tenantWhere);
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
  uploadExpenseAttachments,
  listExpenseAttachments,
  deleteExpenseAttachment,
  EXPENSE_OWNER_TYPE,
};
