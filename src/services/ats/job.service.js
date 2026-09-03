const httpStatus = require('http-status');
const { Op } = require('sequelize');
const { Job, JobApplication, User, Organization, sequelize } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { JOB_QUERY_CONFIG } = require('../../config/query-configs');
const {
  JOB_STATUSES,
  APPLICATION_STATUSES,
} = require('../../utils/ats.constants');
const resumeScreeningService = require('./resume/resume-screening.service');
const {
  buildJobScope,
  generatePublicToken,
  normalizeInterviewRounds,
  nextSequenceCode,
} = require('./ats.shared');
const { sanitizeHtml, isEffectivelyEmpty } = require('../../utils/sanitize-html');

/**
 * job.service — business logic for recruiter-facing job openings.
 *
 * Tenancy + ownership: every read/write is scoped by buildJobScope (super_admin => all,
 * org admin => whole org, recruiter => own jobs). Org id and recruiter id always come
 * from the signed token, never the request body.
 *
 * Status machine (JOB_STATUSES): draft -> open -> {closed|filled} -> open. Publishing
 * stamps published_at; closing/filling stamps closed_at. The public careers page reads
 * only OPEN jobs; everything else shows a friendly message or 404 (draft).
 */

const JOB_ATTRIBUTES = [
  'id',
  'uuid',
  'job_code',
  'public_token',
  'organization_id',
  'created_by_id',
  'title',
  'description',
  'department',
  'location',
  'employment_type',
  'work_mode',
  'experience_min',
  'experience_max',
  'salary_min',
  'salary_max',
  'currency',
  'salary_period',
  'show_salary',
  'openings',
  'skills',
  'interview_rounds',
  'screening_criteria',
  'status',
  'published_at',
  'closed_at',
  'createdAt',
  'updatedAt',
];

/** Normalize an incoming screening_criteria object to the stored shape (or {}). */
const normalizeScreeningCriteria = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (Array.isArray(raw.must_have_skills)) {
    out.must_have_skills = raw.must_have_skills.map((s) => String(s).trim()).filter(Boolean);
  }
  if (Array.isArray(raw.keywords)) {
    out.keywords = raw.keywords.map((s) => String(s).trim()).filter(Boolean);
  }
  if (raw.min_experience != null) out.min_experience = Number(raw.min_experience);
  return out;
};

const JOB_INCLUDE = [
  { model: User, as: 'recruiter', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
  { model: Organization, as: 'organization', attributes: ['uuid', 'name', 'slug'] },
];

/** Fetch a job the caller is allowed to see, or throw 404. */
const findVisibleJob = async (uuid, req, res, transaction) => {
  const job = await Job.findOne({
    where: { uuid, ...buildJobScope(req) },
    attributes: JOB_ATTRIBUTES,
    include: JOB_INCLUDE,
    transaction,
  });
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, (res || req.res).__('job_not_found'));
  }
  return job;
};

/** Validate min<=max on the experience and salary ranges. */
const validateRanges = (job, res) => {
  const expMin = job.experience_min;
  const expMax = job.experience_max;
  if (expMin != null && expMax != null && Number(expMin) > Number(expMax)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_invalid_experience_range'));
  }
  const salMin = job.salary_min;
  const salMax = job.salary_max;
  if (salMin != null && salMax != null && Number(salMin) > Number(salMax)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_invalid_salary_range'));
  }
};

/**
 * Create a job. organization_id + created_by_id come from the token. A unique public
 * token and job code are generated inside the transaction. action:'publish' opens it
 * immediately (which requires at least one interview round).
 */
const createJob = async (body, req, res) => {
  const { auth } = req;
  if (!auth.organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  const publish = body.action === 'publish';
  const rounds = normalizeInterviewRounds(body.interview_rounds);

  // The description is rich text (HTML). Sanitize to a safe subset before storing,
  // since it is rendered on the PUBLIC careers page. Reject an empty (tags-only) body.
  const description = sanitizeHtml(body.description);
  if (isEffectivelyEmpty(description)) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_description_required'));
  }

  const draft = {
    organization_id: auth.organizationId,
    created_by_id: auth.userId,
    title: body.title,
    description,
    department: body.department ?? null,
    location: body.location ?? null,
    employment_type: body.employment_type,
    work_mode: body.work_mode,
    experience_min: body.experience_min ?? null,
    experience_max: body.experience_max ?? null,
    salary_min: body.salary_min ?? null,
    salary_max: body.salary_max ?? null,
    currency: body.currency ?? null,
    salary_period: body.salary_period ?? null,
    show_salary: body.show_salary ?? false,
    openings: body.openings ?? 1,
    skills: Array.isArray(body.skills) ? body.skills : [],
    interview_rounds: rounds,
    screening_criteria: normalizeScreeningCriteria(body.screening_criteria),
  };
  validateRanges(draft, res);

  if (publish && rounds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_publish_requires_rounds'));
  }

  const created = await sequelize.transaction(async (transaction) => {
    const job_code = await nextSequenceCode(Job, 'JOB', transaction);
    return Job.create(
      {
        ...draft,
        job_code,
        public_token: generatePublicToken(),
        status: publish ? JOB_STATUSES.OPEN : JOB_STATUSES.DRAFT,
        published_at: publish ? new Date() : null,
      },
      { transaction }
    );
  });

  return findVisibleJob(created.uuid, req, res);
};

/** List jobs visible to the caller, with search/sort/filter/pagination. */
const listJobs = async (req) => {
  const scopeWhere = buildJobScope(req);
  if (req.query.scope === 'mine') {
    scopeWhere.created_by_id = req.auth.userId;
  }
  return paginate(Job, req.query, JOB_QUERY_CONFIG, {
    scopeWhere,
    attributes: JOB_ATTRIBUTES,
    include: JOB_INCLUDE,
  });
};

/** Read one job (with a light application count summary). */
const getJobByUuid = async (uuid, req, res) => {
  const job = await findVisibleJob(uuid, req, res);
  const applicationCount = await JobApplication.count({ where: { job_id: job.id } });
  return { job, applicationCount };
};

/**
 * Update a job. Only the fields provided are changed. Editing the interview pipeline is
 * allowed, but a round that has in-progress applications parked on it can't be removed
 * (that would strand candidates); we guard against dropping such rounds.
 */
const updateJob = async (uuid, body, req, res) => {
  const updated = await sequelize.transaction(async (transaction) => {
    const job = await Job.findOne({
      where: { uuid, ...buildJobScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!job) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('job_not_found'));
    }

    if (body.interview_rounds !== undefined) {
      const nextRounds = normalizeInterviewRounds(body.interview_rounds);
      const nextKeys = new Set(nextRounds.map((r) => r.key));
      // Which stage keys currently have applications sitting in them?
      const parked = await JobApplication.findAll({
        where: {
          job_id: job.id,
          status: APPLICATION_STATUSES.INTERVIEWING,
          stage_key: { [Op.ne]: null },
        },
        attributes: ['stage_key'],
        group: ['stage_key'],
        transaction,
      });
      const strandedRounds = parked
        .map((p) => p.stage_key)
        .filter((key) => !nextKeys.has(key));
      if (strandedRounds.length > 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_round_in_use'));
      }
      job.interview_rounds = nextRounds;
    }

    // Sanitize the rich-text description before it's assigned below.
    if (body.description !== undefined) {
      const clean = sanitizeHtml(body.description);
      if (isEffectivelyEmpty(clean)) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_description_required'));
      }
      body.description = clean;
    }

    if (body.screening_criteria !== undefined) {
      job.screening_criteria = normalizeScreeningCriteria(body.screening_criteria);
    }

    const assignable = [
      'title',
      'description',
      'department',
      'location',
      'employment_type',
      'work_mode',
      'experience_min',
      'experience_max',
      'salary_min',
      'salary_max',
      'currency',
      'salary_period',
      'show_salary',
      'openings',
      'skills',
    ];
    assignable.forEach((field) => {
      if (body[field] !== undefined) {
        job[field] = body[field];
      }
    });

    validateRanges(job, res);
    // Changing what a candidate is scored against means existing scores are stale.
    const rescoreNeeded =
      job.changed('description') ||
      job.changed('skills') ||
      job.changed('experience_min') ||
      job.changed('screening_criteria');
    await job.save({ transaction });
    return { job, rescoreNeeded };
  });

  // Re-screen existing applications against the new criteria (async, once each).
  if (updated.rescoreNeeded) {
    const apps = await JobApplication.findAll({
      where: { job_id: updated.job.id },
      attributes: ['id'],
    });
    apps.forEach((a) =>
      resumeScreeningService.enqueueSafe(a.id, {
        organizationId: updated.job.organization_id,
        reason: 'rescore',
      })
    );
  }

  return findVisibleJob(updated.job.uuid, req, res);
};

/**
 * Change a job's status (publish / close / mark filled / reopen). Enforces the allowed
 * transitions and stamps published_at / closed_at accordingly.
 */
const changeJobStatus = async (uuid, nextStatus, req, res) => {
  const updated = await sequelize.transaction(async (transaction) => {
    const job = await Job.findOne({
      where: { uuid, ...buildJobScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!job) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('job_not_found'));
    }

    const current = job.status;
    // Legal transitions.
    const allowed = {
      [JOB_STATUSES.DRAFT]: [JOB_STATUSES.OPEN],
      [JOB_STATUSES.OPEN]: [JOB_STATUSES.CLOSED, JOB_STATUSES.FILLED],
      [JOB_STATUSES.CLOSED]: [JOB_STATUSES.OPEN],
      [JOB_STATUSES.FILLED]: [JOB_STATUSES.OPEN],
    };
    if (current === nextStatus || !(allowed[current] || []).includes(nextStatus)) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_invalid_status_transition'));
    }

    // Publishing (to OPEN) requires a defined pipeline.
    if (
      nextStatus === JOB_STATUSES.OPEN &&
      (!Array.isArray(job.interview_rounds) || job.interview_rounds.length === 0)
    ) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_publish_requires_rounds'));
    }

    job.status = nextStatus;
    if (nextStatus === JOB_STATUSES.OPEN) {
      if (!job.published_at) job.published_at = new Date();
      job.closed_at = null;
    } else {
      job.closed_at = new Date();
    }
    await job.save({ transaction });
    return job;
  });

  return findVisibleJob(updated.uuid, req, res);
};

/**
 * Delete a job. Only a draft with no applications can be hard-deleted; a job that has
 * received applications should be closed instead (preserves candidate history).
 */
const deleteJob = async (uuid, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const job = await Job.findOne({
      where: { uuid, ...buildJobScope(req) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!job) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('job_not_found'));
    }
    const count = await JobApplication.count({ where: { job_id: job.id }, transaction });
    if (count > 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('job_has_applications'));
    }
    await job.destroy({ transaction });
  });
};

module.exports = {
  JOB_ATTRIBUTES,
  findVisibleJob,
  createJob,
  listJobs,
  getJobByUuid,
  updateJob,
  changeJobStatus,
  deleteJob,
};
