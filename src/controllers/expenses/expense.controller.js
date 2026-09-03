const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { expenseService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/** Shape an expense for API responses (no internal-only fields leaked). */
const toDto = (expense) => ({
  uuid: expense.uuid,
  expense_number: expense.expense_number,
  title: expense.title,
  category: expense.category,
  expense_date: expense.expense_date,
  notes: expense.notes,
  // amount is DECIMAL — Sequelize returns it as a string; expose a numeric value too.
  amount: expense.amount !== null && expense.amount !== undefined ? Number(expense.amount) : null,
  currency: expense.currency,
  status: expense.status,
  // Legacy name-only metadata kept for backward compatibility.
  attachments: Array.isArray(expense.attachments) ? expense.attachments : [],
  // Real uploaded files (bytes in object storage). Populated by the service on reads
  // via setDataValue('expense_attachments', ...). It is NOT a defined model attribute,
  // so plain property access returns undefined on a Sequelize instance — read it from
  // dataValues (getDataValue) instead. Each: { uuid, url, file_name, file_mime, file_size, uploaded_at }.
  expense_attachments:
    (typeof expense.getDataValue === 'function'
      ? expense.getDataValue('expense_attachments')
      : expense.expense_attachments) || [],
  submitted_at: expense.submitted_at,
  reviewed_at: expense.reviewed_at,
  rejection_reason: expense.rejection_reason,
  created_at: expense.createdAt,
  updated_at: expense.updatedAt,
  created_by: userSummary(expense.creator),
  reviewed_by: userSummary(expense.reviewer),
  organization: expense.organization
    ? {
        uuid: expense.organization.uuid,
        name: expense.organization.name,
        slug: expense.organization.slug,
      }
    : undefined,
});

/** POST /expenses — any authenticated org member with expense.create may create. */
const create = catchAsync(async (req, res) => {
  const expense = await expenseService.createExpense(req.body, req, res);
  res
    .status(httpStatus.CREATED)
    .send({ message: res.__('expense_created'), data: toDto(expense) });
});

/** GET /expenses — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await expenseService.listExpenses(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /expenses/:uuid — visibility-scoped fetch. */
const getOne = catchAsync(async (req, res) => {
  const expense = await expenseService.getExpenseByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('expense_found'), data: toDto(expense) });
});

/** PUT /expenses/:uuid — update a draft/rejected expense (owner only). */
const update = catchAsync(async (req, res) => {
  const expense = await expenseService.updateExpense(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('expense_updated'), data: toDto(expense) });
});

/** PATCH /expenses/:uuid/submit — submit a draft/rejected expense (owner only). */
const submit = catchAsync(async (req, res) => {
  const expense = await expenseService.submitExpense(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('expense_submitted'), data: toDto(expense) });
});

/** PATCH /expenses/:uuid/review — approve/reject a submitted expense (reviewers only). */
const review = catchAsync(async (req, res) => {
  const expense = await expenseService.reviewExpense(
    req.params.uuid,
    req.body.decision,
    req.body.rejection_reason,
    req,
    res
  );
  const message =
    req.body.decision === 'approve' ? res.__('expense_approved') : res.__('expense_rejected');
  res.status(httpStatus.OK).send({ message, data: toDto(expense) });
});

/** DELETE /expenses/:uuid — delete (expense.delete permission required). */
const remove = catchAsync(async (req, res) => {
  await expenseService.deleteExpense(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('expense_deleted'), data: null });
});

/**
 * POST /expenses/:uuid/attachments — upload one or more real files to an expense.
 * multipart/form-data; the multer middleware on the route parses the files first.
 */
const uploadAttachments = catchAsync(async (req, res) => {
  const data = await expenseService.uploadExpenseAttachments(req.params.uuid, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('files_uploaded'), data });
});

/** GET /expenses/:uuid/attachments — list an expense's uploaded files. */
const listAttachments = catchAsync(async (req, res) => {
  const data = await expenseService.listExpenseAttachments(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

/** DELETE /expenses/:uuid/attachments/:attachmentUuid — remove one uploaded file. */
const deleteAttachment = catchAsync(async (req, res) => {
  await expenseService.deleteExpenseAttachment(
    req.params.uuid,
    req.params.attachmentUuid,
    req,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('file_deleted'), data: null });
});

module.exports = {
  create,
  list,
  getOne,
  update,
  submit,
  review,
  remove,
  uploadAttachments,
  listAttachments,
  deleteAttachment,
};
