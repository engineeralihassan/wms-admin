const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { dealService } = require('../../services');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

const accountSummary = (a) =>
  a ? { uuid: a.uuid, account_number: a.account_number, name: a.name } : null;

const contactSummary = (c) =>
  c ? { uuid: c.uuid, first_name: c.first_name, last_name: c.last_name } : null;

const pipelineSummary = (p) =>
  p ? { uuid: p.uuid, name: p.name, stages: Array.isArray(p.stages) ? p.stages : undefined } : null;

/** Shape a deal for API responses. Internal ids are never exposed. */
const toDto = (d) => ({
  uuid: d.uuid,
  deal_number: d.deal_number,
  title: d.title,
  amount: d.amount != null ? Number(d.amount) : null,
  currency: d.currency,
  probability: d.probability,
  expected_close_date: d.expected_close_date,
  closed_at: d.closed_at,
  status: d.status,
  stage_key: d.stage_key,
  custom_fields: d.custom_fields || {},
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  owner: userSummary(d.owner),
  creator: userSummary(d.creator),
  account: accountSummary(d.account),
  contact: contactSummary(d.contact),
  pipeline: pipelineSummary(d.pipeline),
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

/** GET /sales/deals — scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await dealService.listDeals(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /sales/deals/board?pipeline= — Kanban columns grouped by stage. */
const board = catchAsync(async (req, res) => {
  const { pipeline, columns } = await dealService.getBoard(req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: {
      pipeline: pipelineSummary(pipeline),
      columns: columns.map((col) => ({ stage: col.stage, deals: col.deals.map(toDto) })),
    },
  });
});

/** POST /sales/deals — create. */
const create = catchAsync(async (req, res) => {
  const { deal, events } = await dealService.createDeal(req.body, req, res);
  res.status(httpStatus.CREATED).send({
    message: res.__('deal_created'),
    data: { ...toDto(deal), events: events.map(eventToDto) },
  });
});

/** GET /sales/deals/:uuid — full deal with event history. */
const getOne = catchAsync(async (req, res) => {
  const { deal, events } = await dealService.getDealByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('deal_found'),
    data: { ...toDto(deal), events: events.map(eventToDto) },
  });
});

/** PATCH /sales/deals/:uuid — update fields/links. */
const update = catchAsync(async (req, res) => {
  const { deal, events } = await dealService.updateDeal(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('deal_updated'),
    data: { ...toDto(deal), events: events.map(eventToDto) },
  });
});

/** POST /sales/deals/:uuid/stage — move to another pipeline stage. */
const changeStage = catchAsync(async (req, res) => {
  const { deal, events } = await dealService.changeStage(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('deal_stage_updated'),
    data: { ...toDto(deal), events: events.map(eventToDto) },
  });
});

/** POST /sales/deals/:uuid/reassign — change the deal owner. */
const reassign = catchAsync(async (req, res) => {
  const { deal, events } = await dealService.reassignDeal(req.params.uuid, req.body.owner_uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('deal_reassigned'),
    data: { ...toDto(deal), events: events.map(eventToDto) },
  });
});

/** DELETE /sales/deals/:uuid. */
const remove = catchAsync(async (req, res) => {
  await dealService.deleteDeal(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('deal_deleted'), data: null });
});

module.exports = {
  toDto,
  eventToDto,
  list,
  board,
  create,
  getOne,
  update,
  changeStage,
  reassign,
  remove,
};
