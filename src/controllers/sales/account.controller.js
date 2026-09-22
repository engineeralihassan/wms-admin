const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { accountService } = require('../../services');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

/** Shape an account for API responses. Internal ids are never exposed. */
const toDto = (a) => ({
  uuid: a.uuid,
  account_number: a.account_number,
  name: a.name,
  industry: a.industry,
  website: a.website,
  phone: a.phone,
  email: a.email,
  address: a.address || null,
  annual_revenue: a.annual_revenue != null ? Number(a.annual_revenue) : null,
  employee_count: a.employee_count,
  account_type: a.account_type,
  custom_fields: a.custom_fields || {},
  created_at: a.createdAt,
  updated_at: a.updatedAt,
  owner: userSummary(a.owner),
  creator: userSummary(a.creator),
});

const contactSummary = (c) => ({
  uuid: c.uuid,
  first_name: c.first_name,
  last_name: c.last_name,
  email: c.email,
  phone: c.phone,
  job_title: c.job_title,
  is_primary: c.is_primary,
});

const dealSummary = (d) => ({
  uuid: d.uuid,
  deal_number: d.deal_number,
  title: d.title,
  amount: d.amount != null ? Number(d.amount) : null,
  currency: d.currency,
  status: d.status,
  stage_key: d.stage_key,
  probability: d.probability,
  expected_close_date: d.expected_close_date,
});

/** GET /sales/accounts — scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await accountService.listAccounts(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** POST /sales/accounts — create. */
const create = catchAsync(async (req, res) => {
  const { account, contacts, deals } = await accountService.createAccount(req.body, req, res);
  res.status(httpStatus.CREATED).send({
    message: res.__('account_created'),
    data: { ...toDto(account), contacts: contacts.map(contactSummary), deals: deals.map(dealSummary) },
  });
});

/** GET /sales/accounts/:uuid — account 360 (contacts + deals). */
const getOne = catchAsync(async (req, res) => {
  const { account, contacts, deals } = await accountService.getAccountByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('account_found'),
    data: { ...toDto(account), contacts: contacts.map(contactSummary), deals: deals.map(dealSummary) },
  });
});

/** PATCH /sales/accounts/:uuid — update. */
const update = catchAsync(async (req, res) => {
  const { account, contacts, deals } = await accountService.updateAccount(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('account_updated'),
    data: { ...toDto(account), contacts: contacts.map(contactSummary), deals: deals.map(dealSummary) },
  });
});

/** DELETE /sales/accounts/:uuid — delete (contacts/deals detached, not destroyed). */
const remove = catchAsync(async (req, res) => {
  await accountService.deleteAccount(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('account_deleted'), data: null });
});

module.exports = { toDto, list, create, getOne, update, remove };
