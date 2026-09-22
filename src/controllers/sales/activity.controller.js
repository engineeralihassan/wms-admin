const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { activityService } = require('../../services');
const { ACTIVITY_STATUSES } = require('../../utils/sales.constants');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

/** Shape an activity for API responses. Internal ids are never exposed. */
const toDto = (a) => ({
  uuid: a.uuid,
  related_type: a.related_type,
  activity_type: a.activity_type,
  subject: a.subject,
  body: a.body,
  due_at: a.due_at,
  completed_at: a.completed_at,
  status: a.status,
  created_at: a.createdAt,
  updated_at: a.updatedAt,
  owner: userSummary(a.owner),
  creator: userSummary(a.creator),
});

/** GET /sales/:relatedType/:relatedUuid/activities — timeline for a record. */
const listForRecord = catchAsync(async (req, res) => {
  const { data, meta } = await activityService.listForRecord(
    req.params.relatedType,
    req.params.relatedUuid,
    req,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /sales/activities/my-tasks — my open/overdue tasks & follow-ups. */
const myTasks = catchAsync(async (req, res) => {
  const { data, meta } = await activityService.listMyTasks(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** POST /sales/activities — log an activity / create a task. */
const create = catchAsync(async (req, res) => {
  const { activity } = await activityService.createActivity(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('activity_created'), data: toDto(activity) });
});

/** GET /sales/activities/:uuid. */
const getOne = catchAsync(async (req, res) => {
  const { activity } = await activityService.getActivityByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('activity_found'), data: toDto(activity) });
});

/** PATCH /sales/activities/:uuid — edit subject/body/due date. */
const update = catchAsync(async (req, res) => {
  const { activity } = await activityService.updateActivity(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('activity_updated'), data: toDto(activity) });
});

/** POST /sales/activities/:uuid/complete — mark a task done. */
const complete = catchAsync(async (req, res) => {
  const { activity } = await activityService.setActivityStatus(
    req.params.uuid,
    ACTIVITY_STATUSES.COMPLETED,
    req,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('activity_completed'), data: toDto(activity) });
});

/** POST /sales/activities/:uuid/cancel — cancel a task. */
const cancel = catchAsync(async (req, res) => {
  const { activity } = await activityService.setActivityStatus(
    req.params.uuid,
    ACTIVITY_STATUSES.CANCELLED,
    req,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('activity_cancelled'), data: toDto(activity) });
});

/** DELETE /sales/activities/:uuid. */
const remove = catchAsync(async (req, res) => {
  await activityService.deleteActivity(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('activity_deleted'), data: null });
});

module.exports = { toDto, listForRecord, myTasks, create, getOne, update, complete, cancel, remove };
