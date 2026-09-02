const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { leaveService } = require('../../services');
const { LEAVE_DECISIONS } = require('../../utils/leave.constants');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

const leaveTypeSummary = (type) =>
  type
    ? {
        uuid: type.uuid,
        key: type.key,
        name: type.name,
        is_paid: type.is_paid,
        requires_balance: type.requires_balance,
        color: type.color,
      }
    : null;

/** Shape a leave request for API responses (no internal-only fields leaked). */
const toDto = (leave) => ({
  uuid: leave.uuid,
  leave_number: leave.leave_number,
  start_date: leave.start_date,
  end_date: leave.end_date,
  day_portion: leave.day_portion,
  total_days: Number(leave.total_days),
  reason: leave.reason,
  status: leave.status,
  attachments: Array.isArray(leave.attachments) ? leave.attachments : [],
  submitted_at: leave.submitted_at,
  reviewed_at: leave.reviewed_at,
  rejection_reason: leave.rejection_reason,
  created_at: leave.createdAt,
  updated_at: leave.updatedAt,
  leave_type: leaveTypeSummary(leave.leaveType),
  applicant: userSummary(leave.applicant),
  reviewer: userSummary(leave.reviewer),
  organization: leave.organization
    ? { uuid: leave.organization.uuid, name: leave.organization.name, slug: leave.organization.slug }
    : undefined,
});

/** Shape a leave type for API responses. */
const typeToDto = (type) => ({
  uuid: type.uuid,
  key: type.key,
  name: type.name,
  is_paid: type.is_paid,
  requires_balance: type.requires_balance,
  color: type.color,
  is_active: type.is_active,
  created_at: type.createdAt,
  updated_at: type.updatedAt,
});

/** Shape a balance for API responses, including computed available days. */
const balanceToDto = (balance) => {
  const allocated = Number(balance.allocated);
  const used = Number(balance.used);
  const pending = Number(balance.pending);
  return {
    uuid: balance.uuid,
    period_year: balance.period_year,
    allocated,
    used,
    pending,
    available: Math.round((allocated - used - pending) * 100) / 100,
    leave_type: leaveTypeSummary(balance.leaveType),
    user: userSummary(balance.user),
    created_at: balance.createdAt,
    updated_at: balance.updatedAt,
  };
};

/** POST /leaves — create a draft or submit a leave request. */
const create = catchAsync(async (req, res) => {
  const leave = await leaveService.createLeave(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('leave_created'), data: toDto(leave) });
});

/** GET /leaves — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await leaveService.listLeaves(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /leaves/:uuid — visibility-scoped fetch. */
const getOne = catchAsync(async (req, res) => {
  const leave = await leaveService.getLeaveByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_found'), data: toDto(leave) });
});

/** PUT /leaves/:uuid — edit own draft/rejected request (optionally re-submit). */
const update = catchAsync(async (req, res) => {
  const leave = await leaveService.updateLeave(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_updated'), data: toDto(leave) });
});

/** PATCH /leaves/:uuid/submit — submit a draft/rejected request for approval. */
const submit = catchAsync(async (req, res) => {
  const leave = await leaveService.submitLeave(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_submitted'), data: toDto(leave) });
});

/** PATCH /leaves/:uuid/withdraw — applicant withdraws a pending request. */
const withdraw = catchAsync(async (req, res) => {
  const leave = await leaveService.withdrawLeave(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_withdrawn'), data: toDto(leave) });
});

/** PATCH /leaves/:uuid/decision — approver approves or rejects a submitted request. */
const decide = catchAsync(async (req, res) => {
  const leave = await leaveService.decideLeave(
    req.params.uuid,
    req.body.decision,
    req.body.rejection_reason,
    req,
    res
  );
  const message =
    req.body.decision === LEAVE_DECISIONS.APPROVE ? res.__('leave_approved') : res.__('leave_rejected');
  res.status(httpStatus.OK).send({ message, data: toDto(leave) });
});

/** PATCH /leaves/:uuid/cancel — approver cancels a submitted/approved request. */
const cancel = catchAsync(async (req, res) => {
  const leave = await leaveService.cancelLeave(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_cancelled'), data: toDto(leave) });
});

/** DELETE /leaves/:uuid — delete a draft/rejected request. */
const remove = catchAsync(async (req, res) => {
  await leaveService.deleteLeave(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_deleted'), data: null });
});

/** GET /leaves/balances/me — the caller's own balances. */
const myBalances = catchAsync(async (req, res) => {
  const { year, balances } = await leaveService.getMyBalances(req);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('success'), data: { period_year: year, balances: balances.map(balanceToDto) } });
});

/** GET /leaves/calendar — timesheet-facing leave days in a range. */
const calendar = catchAsync(async (req, res) => {
  const days = await leaveService.getCalendar(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: days });
});

// ── Leave type admin ────────────────────────────────────────────────────────

const listTypes = catchAsync(async (req, res) => {
  const types = await leaveService.listLeaveTypes(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: types.map(typeToDto) });
});

const createType = catchAsync(async (req, res) => {
  const type = await leaveService.createLeaveType(req.body, req, res);
  res
    .status(httpStatus.CREATED)
    .send({ message: res.__('leave_type_created'), data: typeToDto(type) });
});

const updateType = catchAsync(async (req, res) => {
  const type = await leaveService.updateLeaveType(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('leave_type_updated'), data: typeToDto(type) });
});

// ── Balance admin ───────────────────────────────────────────────────────────

const listBalancesCtrl = catchAsync(async (req, res) => {
  const { data, meta } = await leaveService.listBalances(req);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('success'), data: data.map(balanceToDto), meta });
});

const allocate = catchAsync(async (req, res) => {
  const balance = await leaveService.allocateBalance(req.body, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('leave_balance_allocated'), data: balanceToDto(balance) });
});

module.exports = {
  create,
  list,
  getOne,
  update,
  submit,
  withdraw,
  decide,
  cancel,
  remove,
  myBalances,
  calendar,
  listTypes,
  createType,
  updateType,
  listBalances: listBalancesCtrl,
  allocate,
};
