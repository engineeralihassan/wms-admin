const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { applicationService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

const jobSummary = (job) =>
  job
    ? {
        uuid: job.uuid,
        job_code: job.job_code,
        title: job.title,
        status: job.status,
        interview_rounds: Array.isArray(job.interview_rounds) ? job.interview_rounds : undefined,
      }
    : null;

/** Shape an application for recruiter-facing API responses. */
const toDto = (a) => ({
  uuid: a.uuid,
  application_number: a.application_number,
  candidate_name: a.candidate_name,
  candidate_email: a.candidate_email,
  candidate_phone: a.candidate_phone,
  linkedin_url: a.linkedin_url,
  portfolio_url: a.portfolio_url,
  experience_years: a.experience_years != null ? Number(a.experience_years) : null,
  cover_note: a.cover_note,
  status: a.status,
  stage_key: a.stage_key,
  rating: a.rating,
  decision_reason: a.decision_reason,
  source: a.source,
  submitted_at: a.submitted_at,
  created_at: a.createdAt,
  updated_at: a.updatedAt,
  // Resume screening (populated asynchronously by the resume worker).
  screening_status: a.screening_status,
  screening_score: a.screening_score,
  screening_band: a.screening_band,
  screening_breakdown: a.screening_breakdown || null,
  screened_at: a.screened_at,
  job: jobSummary(a.job),
  reviewer: userSummary(a.reviewer),
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

/** GET /jobs/:uuid/applications — applications for one job. */
const listForJob = catchAsync(async (req, res) => {
  const { data, meta } = await applicationService.listApplicationsForJob(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /jobs/:uuid/applications/ranked — top-N candidates by cached screening score. */
const listRankedForJob = catchAsync(async (req, res) => {
  const result = await applicationService.listRankedApplications(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: result.items.map(toDto),
    meta: {
      limit: result.limit,
      total_ranked: result.total_ranked,
      screening: result.screening,
    },
  });
});

/** GET /applications/:uuid — full application with attachments + event history. */
const getOne = catchAsync(async (req, res) => {
  const { application, attachments, events } = await applicationService.getApplicationByUuid(
    req.params.uuid,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('application_found'),
    data: { ...toDto(application), attachments, events: events.map(eventToDto) },
  });
});

/** PATCH /applications/:uuid/status — move through the hiring lifecycle. */
const changeStatus = catchAsync(async (req, res) => {
  const { application, attachments, events } = await applicationService.changeStatus(
    req.params.uuid,
    req.body,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('application_status_updated'),
    data: { ...toDto(application), attachments, events: events.map(eventToDto) },
  });
});

/** PATCH /applications/:uuid/rating — set/update the candidate rating. */
const rate = catchAsync(async (req, res) => {
  const { application, attachments, events } = await applicationService.rateApplication(
    req.params.uuid,
    req.body.rating,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('application_rated'),
    data: { ...toDto(application), attachments, events: events.map(eventToDto) },
  });
});

/** POST /applications/:uuid/notes — append an internal note. */
const addNote = catchAsync(async (req, res) => {
  const { application, attachments, events } = await applicationService.addNote(
    req.params.uuid,
    req.body.note,
    req,
    res
  );
  res.status(httpStatus.CREATED).send({
    message: res.__('application_note_added'),
    data: { ...toDto(application), attachments, events: events.map(eventToDto) },
  });
});

/** DELETE /applications/:uuid — delete an application and its files. */
const remove = catchAsync(async (req, res) => {
  await applicationService.deleteApplication(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('application_deleted'), data: null });
});

module.exports = {
  toDto,
  eventToDto,
  listForJob,
  listRankedForJob,
  getOne,
  changeStatus,
  rate,
  addNote,
  remove,
};
