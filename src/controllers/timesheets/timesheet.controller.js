const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { timesheetService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

const projectSummary = (project) =>
  project
    ? {
        uuid: project.uuid,
        project_code: project.project_code,
        name: project.name,
        status: project.status,
      }
    : null;

/** Shape a single daily entry (uuid + numeric hours). */
const entryDto = (entry) => ({
  uuid: entry.uuid,
  work_date: entry.work_date,
  hours: entry.hours !== null && entry.hours !== undefined ? Number(entry.hours) : 0,
  note: entry.note ?? null,
});

/** Shape a timesheet for API responses (no internal ids leaked). */
const toDto = (timesheet) => {
  const entries =
    (typeof timesheet.getDataValue === 'function'
      ? timesheet.getDataValue('entries')
      : timesheet.entries) || [];
  return {
    uuid: timesheet.uuid,
    timesheet_number: timesheet.timesheet_number,
    week_start_date: timesheet.week_start_date,
    week_end_date: timesheet.week_end_date,
    due_date: timesheet.due_date,
    lock_date: timesheet.lock_date,
    // total_hours is DECIMAL — Sequelize returns a string; expose a number.
    total_hours:
      timesheet.total_hours !== null && timesheet.total_hours !== undefined
        ? Number(timesheet.total_hours)
        : 0,
    status: timesheet.status,
    submitted_at: timesheet.submitted_at,
    reviewed_at: timesheet.reviewed_at,
    rejection_reason: timesheet.rejection_reason,
    review_note: timesheet.review_note,
    auto_generated: timesheet.auto_generated,
    entries: entries.map(entryDto),
    // Real uploaded files (populated by the service via setDataValue).
    attachments:
      (typeof timesheet.getDataValue === 'function'
        ? timesheet.getDataValue('timesheet_attachments')
        : timesheet.timesheet_attachments) || [],
    created_at: timesheet.createdAt,
    updated_at: timesheet.updatedAt,
    project: projectSummary(timesheet.project),
    owner: userSummary(timesheet.owner),
    reviewed_by: userSummary(timesheet.reviewer),
    organization: timesheet.organization
      ? {
          uuid: timesheet.organization.uuid,
          name: timesheet.organization.name,
          slug: timesheet.organization.slug,
        }
      : undefined,
  };
};

/** POST /timesheets — open (ensure) this week's timesheet for a project. */
const create = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.createTimesheet(req.body, req, res);
  res
    .status(httpStatus.CREATED)
    .send({ message: res.__('timesheet_created'), data: toDto(timesheet) });
});

/** GET /timesheets — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await timesheetService.listTimesheets(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /timesheets/:uuid — visibility-scoped fetch with the 7 daily entries. */
const getOne = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.getTimesheetByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('timesheet_found'), data: toDto(timesheet) });
});

/** PATCH /timesheets/:uuid/entries — owner bulk-saves daily hours/notes (draft). */
const saveEntries = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.saveEntries(req.params.uuid, req.body.entries, req, res);
  res.status(httpStatus.OK).send({ message: res.__('timesheet_updated'), data: toDto(timesheet) });
});

/** POST /timesheets/:uuid/submit — owner submits the week. */
const submit = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.submitTimesheet(req.params.uuid, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('timesheet_submitted'), data: toDto(timesheet) });
});

/** POST /timesheets/:uuid/withdraw — owner withdraws a submitted week. */
const withdraw = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.withdrawTimesheet(req.params.uuid, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('timesheet_withdrawn'), data: toDto(timesheet) });
});

/** POST /timesheets/:uuid/review — approver approves/rejects a submitted week. */
const review = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.reviewTimesheet(
    req.params.uuid,
    req.body.decision,
    req.body.rejection_reason,
    req.body.review_note,
    req,
    res
  );
  const message =
    req.body.decision === 'approve' ? res.__('timesheet_approved') : res.__('timesheet_rejected');
  res.status(httpStatus.OK).send({ message, data: toDto(timesheet) });
});

/** PATCH /timesheets/:uuid — approver correction (edit entries + accept, notify owner). */
const correct = catchAsync(async (req, res) => {
  const timesheet = await timesheetService.correctTimesheet(req.params.uuid, req.body, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('timesheet_corrected'), data: toDto(timesheet) });
});

/** DELETE /timesheets/:uuid — owner (editable) or approver removes a timesheet. */
const remove = catchAsync(async (req, res) => {
  await timesheetService.deleteTimesheet(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('timesheet_deleted'), data: null });
});

/** GET /timesheets/projects — the project picker (projects the caller can log against). */
const listProjects = catchAsync(async (req, res) => {
  const { data, meta } = await timesheetService.listLoggableProjects(req);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((p) => projectSummary(p)),
    meta,
  });
});

module.exports = {
  create,
  list,
  getOne,
  saveEntries,
  submit,
  withdraw,
  review,
  correct,
  remove,
  listProjects,
};
