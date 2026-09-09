const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { interviewService } = require('../../services');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

/** Shape one participant for API responses (never leaks internal user ids). */
const participantToDto = (p) => ({
  uuid: p.uuid,
  role: p.role,
  email: p.email,
  name: p.name,
  response_status: p.response_status,
  user: userSummary(p.user),
});

/** Shape an interview for recruiter-facing API responses. */
const toDto = (i) => ({
  uuid: i.uuid,
  interview_number: i.interview_number,
  stage_key: i.stage_key,
  title: i.title,
  scheduled_start: i.scheduled_start,
  scheduled_end: i.scheduled_end,
  duration_minutes: i.duration_minutes,
  timezone: i.timezone,
  mode: i.mode,
  provider: i.provider,
  meeting_url: i.meeting_url,
  location: i.location,
  status: i.status,
  notes: i.notes,
  outcome_note: i.outcome_note,
  cancel_reason: i.cancel_reason,
  external_event_id: i.external_event_id,
  created_at: i.createdAt,
  updated_at: i.updatedAt,
  organizer: userSummary(i.organizer),
  job: i.job ? { uuid: i.job.uuid, job_code: i.job.job_code, title: i.job.title } : null,
  application: i.application
    ? {
        uuid: i.application.uuid,
        application_number: i.application.application_number,
        candidate_name: i.application.candidate_name,
        candidate_email: i.application.candidate_email,
        status: i.application.status,
        stage_key: i.application.stage_key,
      }
    : null,
  participants: Array.isArray(i.participants) ? i.participants.map(participantToDto) : [],
});

/** GET /applications/:uuid/interviewers — org users offered as interviewer options. */
const listInterviewers = catchAsync(async (req, res) => {
  const { data, meta } = await interviewService.listInterviewers(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((u) => ({
      uuid: u.uuid,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
    })),
    meta,
  });
});

/** GET /applications/:uuid/interviews/availability — bookable slots. */
const getAvailability = catchAsync(async (req, res) => {
  const data = await interviewService.getAvailability(req.params.uuid, req.query, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

/** GET /applications/:uuid/interviews — interviews for one application. */
const listForApplication = catchAsync(async (req, res) => {
  const { data, meta } = await interviewService.listForApplication(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** POST /applications/:uuid/interviews — schedule a new interview. */
const schedule = catchAsync(async (req, res) => {
  const interview = await interviewService.scheduleInterview(req.params.uuid, req.body, req, res);
  res
    .status(httpStatus.CREATED)
    .send({ message: res.__('interview_scheduled'), data: toDto(interview) });
});

/** GET /interviews/:uuid — one interview with its panel. */
const getOne = catchAsync(async (req, res) => {
  const interview = await interviewService.getInterviewByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('interview_found'), data: toDto(interview) });
});

/** PATCH /interviews/:uuid/reschedule — move to a new time. */
const reschedule = catchAsync(async (req, res) => {
  const interview = await interviewService.rescheduleInterview(req.params.uuid, req.body, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('interview_rescheduled'), data: toDto(interview) });
});

/** PATCH /interviews/:uuid/cancel — cancel a scheduled interview. */
const cancel = catchAsync(async (req, res) => {
  const interview = await interviewService.cancelInterview(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('interview_cancelled'), data: toDto(interview) });
});

/** PATCH /interviews/:uuid/complete — mark completed / no-show. */
const complete = catchAsync(async (req, res) => {
  const interview = await interviewService.completeInterview(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('interview_completed'), data: toDto(interview) });
});

/** GET /interviews/providers — which calendar providers are available. */
const listProviders = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).send({ message: res.__('success'), data: interviewService.listProviders() });
});

module.exports = {
  toDto,
  listInterviewers,
  getAvailability,
  listForApplication,
  schedule,
  getOne,
  reschedule,
  cancel,
  complete,
  listProviders,
};
