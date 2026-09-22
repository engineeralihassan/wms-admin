const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { leadService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/** Shape a lead for API responses. Internal ids are never exposed. */
const toDto = (l) => ({
  uuid: l.uuid,
  lead_number: l.lead_number,
  first_name: l.first_name,
  last_name: l.last_name,
  email: l.email,
  phone: l.phone,
  job_title: l.job_title,
  company_name: l.company_name,
  industry: l.industry,
  website: l.website,
  source: l.source,
  status: l.status,
  estimated_value: l.estimated_value != null ? Number(l.estimated_value) : null,
  currency: l.currency,
  custom_fields: l.custom_fields || {},
  converted_at: l.converted_at,
  ai_score: l.ai_score,
  ai_band: l.ai_band,
  ai_breakdown: l.ai_breakdown || null,
  created_at: l.createdAt,
  updated_at: l.updatedAt,
  owner: userSummary(l.owner),
  creator: userSummary(l.creator),
});

/** Shape one audit-trail event. */
const eventToDto = (e) => ({
  uuid: e.uuid,
  entry_type: e.entry_type,
  from_value: e.from_value,
  to_value: e.to_value,
  note: e.note,
  created_at: e.createdAt,
  actor: userSummary(e.actor),
});

/** Summaries of the records created during conversion. */
const convertedToDto = (l) => ({
  ...toDto(l),
  converted_account: l.convertedAccount
    ? { uuid: l.convertedAccount.uuid, account_number: l.convertedAccount.account_number, name: l.convertedAccount.name }
    : null,
  converted_contact: l.convertedContact
    ? { uuid: l.convertedContact.uuid, first_name: l.convertedContact.first_name, last_name: l.convertedContact.last_name }
    : null,
  converted_deal: l.convertedDeal
    ? {
        uuid: l.convertedDeal.uuid,
        deal_number: l.convertedDeal.deal_number,
        title: l.convertedDeal.title,
        amount: l.convertedDeal.amount != null ? Number(l.convertedDeal.amount) : null,
        currency: l.convertedDeal.currency,
        status: l.convertedDeal.status,
      }
    : null,
});

/** GET /sales/leads — scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await leadService.listLeads(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** POST /sales/leads — create a lead. */
const create = catchAsync(async (req, res) => {
  const { lead, events } = await leadService.createLead(req.body, req, res);
  res.status(httpStatus.CREATED).send({
    message: res.__('lead_created'),
    data: { ...toDto(lead), events: events.map(eventToDto) },
  });
});

/** GET /sales/leads/:uuid — full lead with event history. */
const getOne = catchAsync(async (req, res) => {
  const { lead, events } = await leadService.getLeadByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('lead_found'),
    data: { ...toDto(lead), events: events.map(eventToDto) },
  });
});

/** PATCH /sales/leads/:uuid — update fields / status. */
const update = catchAsync(async (req, res) => {
  const { lead, events } = await leadService.updateLead(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('lead_updated'),
    data: { ...toDto(lead), events: events.map(eventToDto) },
  });
});

/** POST /sales/leads/:uuid/assign — reassign the lead owner. */
const assign = catchAsync(async (req, res) => {
  const { lead, events } = await leadService.assignLead(req.params.uuid, req.body.owner_uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('lead_assigned'),
    data: { ...toDto(lead), events: events.map(eventToDto) },
  });
});

/** POST /sales/leads/:uuid/convert — convert into account/contact/(deal). */
const convert = catchAsync(async (req, res) => {
  const lead = await leadService.convertLead(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('lead_converted'),
    data: convertedToDto(lead),
  });
});

/** DELETE /sales/leads/:uuid — delete a lead. */
const remove = catchAsync(async (req, res) => {
  await leadService.deleteLead(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('lead_deleted'), data: null });
});

module.exports = {
  toDto,
  eventToDto,
  list,
  create,
  getOne,
  update,
  assign,
  convert,
  remove,
};
