const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { jobService } = require('../../services');

/** Public app URL used to build the shareable careers link (falls back to API domain). */
const careersBaseUrl = () =>
  (process.env.CLIENT_URL || process.env.DOMAIN || '').replace(/\/+$/, '');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

const orgSummary = (org) =>
  org ? { uuid: org.uuid, name: org.name, slug: org.slug } : undefined;

const num = (v) => (v == null ? null : Number(v));

/** Shape a job for recruiter-facing API responses (no internal id leaked). */
const toDto = (job) => ({
  uuid: job.uuid,
  job_code: job.job_code,
  title: job.title,
  description: job.description,
  department: job.department,
  location: job.location,
  employment_type: job.employment_type,
  work_mode: job.work_mode,
  experience_min: job.experience_min,
  experience_max: job.experience_max,
  salary_min: num(job.salary_min),
  salary_max: num(job.salary_max),
  currency: job.currency,
  salary_period: job.salary_period,
  show_salary: job.show_salary,
  openings: job.openings,
  skills: Array.isArray(job.skills) ? job.skills : [],
  interview_rounds: Array.isArray(job.interview_rounds) ? job.interview_rounds : [],
  screening_criteria: job.screening_criteria || {},
  status: job.status,
  public_token: job.public_token,
  // Convenience: the full shareable link the recruiter can copy.
  public_url: `${careersBaseUrl()}/careers/${job.public_token}`,
  published_at: job.published_at,
  closed_at: job.closed_at,
  created_at: job.createdAt,
  updated_at: job.updatedAt,
  recruiter: userSummary(job.recruiter),
  organization: orgSummary(job.organization),
});

/** POST /jobs — create a draft or publish a job. */
const create = catchAsync(async (req, res) => {
  const job = await jobService.createJob(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('job_created'), data: toDto(job) });
});

/** GET /jobs — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await jobService.listJobs(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /jobs/:uuid — visibility-scoped fetch with an application count. */
const getOne = catchAsync(async (req, res) => {
  const { job, applicationCount } = await jobService.getJobByUuid(req.params.uuid, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('job_found'), data: { ...toDto(job), application_count: applicationCount } });
});

/** PUT /jobs/:uuid — edit a job. */
const update = catchAsync(async (req, res) => {
  const job = await jobService.updateJob(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('job_updated'), data: toDto(job) });
});

/** PATCH /jobs/:uuid/status — publish / close / mark filled / reopen. */
const changeStatus = catchAsync(async (req, res) => {
  const job = await jobService.changeJobStatus(req.params.uuid, req.body.status, req, res);
  res.status(httpStatus.OK).send({ message: res.__('job_status_updated'), data: toDto(job) });
});

/** DELETE /jobs/:uuid — delete a draft job with no applications. */
const remove = catchAsync(async (req, res) => {
  await jobService.deleteJob(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('job_deleted'), data: null });
});

module.exports = {
  toDto,
  create,
  list,
  getOne,
  update,
  changeStatus,
  remove,
};
