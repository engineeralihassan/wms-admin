const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { contactService } = require('../../services');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

const accountSummary = (account) =>
  account ? { uuid: account.uuid, account_number: account.account_number, name: account.name } : null;

/** Shape a contact for API responses. Internal ids are never exposed. */
const toDto = (c) => ({
  uuid: c.uuid,
  first_name: c.first_name,
  last_name: c.last_name,
  email: c.email,
  phone: c.phone,
  job_title: c.job_title,
  is_primary: c.is_primary,
  custom_fields: c.custom_fields || {},
  created_at: c.createdAt,
  updated_at: c.updatedAt,
  account: accountSummary(c.account),
  owner: userSummary(c.owner),
  creator: userSummary(c.creator),
});

/** GET /sales/contacts — scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await contactService.listContacts(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** POST /sales/contacts — create (account optional for B2C). */
const create = catchAsync(async (req, res) => {
  const { contact } = await contactService.createContact(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('contact_created'), data: toDto(contact) });
});

/** GET /sales/contacts/:uuid. */
const getOne = catchAsync(async (req, res) => {
  const { contact } = await contactService.getContactByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('contact_found'), data: toDto(contact) });
});

/** PATCH /sales/contacts/:uuid — update. */
const update = catchAsync(async (req, res) => {
  const { contact } = await contactService.updateContact(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('contact_updated'), data: toDto(contact) });
});

/** DELETE /sales/contacts/:uuid. */
const remove = catchAsync(async (req, res) => {
  await contactService.deleteContact(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('contact_deleted'), data: null });
});

module.exports = { toDto, list, create, getOne, update, remove };
