const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { applicationService } = require('../../services');

const num = (v) => (v == null ? null : Number(v));

/**
 * PUBLIC job DTO — deliberately minimal. Exposes only what a candidate needs to read
 * the posting and decide to apply. Never leaks internal ids, the recruiter's identity,
 * or org-internal fields. Salary is shown only when the recruiter opted in.
 */
const publicJobDto = (job, available, reason) => {
  const base = {
    title: job.title,
    status: job.status,
    available,
    // Present only when the job is not accepting applications, so the page can render
    // the right friendly message ("closed" | "filled").
    unavailable_reason: available ? undefined : reason,
    organization: job.organization
      ? { name: job.organization.name, slug: job.organization.slug }
      : undefined,
  };
  // Full details only when the job is live; a closed/filled job shows just the title +
  // the friendly message, nothing else.
  if (available) {
    Object.assign(base, {
      description: job.description,
      department: job.department,
      location: job.location,
      employment_type: job.employment_type,
      work_mode: job.work_mode,
      experience_min: job.experience_min,
      experience_max: job.experience_max,
      openings: job.openings,
      skills: Array.isArray(job.skills) ? job.skills : [],
      salary: job.show_salary
        ? {
            min: num(job.salary_min),
            max: num(job.salary_max),
            currency: job.currency,
            period: job.salary_period,
          }
        : undefined,
      posted_at: job.published_at,
    });
  }
  return base;
};

/**
 * GET /careers/:token — public job view. Returns 200 with available:true (full details
 * + apply form data) for an OPEN job, or available:false + a reason for a CLOSED/FILLED
 * job so the page can show a "position filled / no longer accepting" message. A draft
 * or unknown token is a 404.
 */
const getPublicJob = catchAsync(async (req, res) => {
  const { job, available, reason } = await applicationService.getPublicJobByToken(
    req.params.token,
    res
  );
  res
    .status(httpStatus.OK)
    .send({ message: res.__('success'), data: publicJobDto(job, available, reason) });
});

/**
 * POST /careers/:token/apply — submit an application (multipart: fields + CV files).
 * Returns a public-safe acknowledgement (application number + candidate name) only.
 */
const apply = catchAsync(async (req, res) => {
  const data = await applicationService.applyToJob(req.params.token, req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('application_submitted'), data });
});

module.exports = {
  getPublicJob,
  apply,
};
