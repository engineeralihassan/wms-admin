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
  attachments: Array.isArray(expense.attachments) ? expense.attachments : [],
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

module.exports = { create, list, getOne, update, submit, review, remove };
