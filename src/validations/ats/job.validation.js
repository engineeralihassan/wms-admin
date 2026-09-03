const Joi = require('joi');
const {
  JOB_STATUSES,
  JOB_EMPLOYMENT_TYPES,
  JOB_WORK_MODES,
  JOB_CURRENCIES,
  JOB_SALARY_PERIODS,
  JOB_TITLE_MAX_LENGTH,
  JOB_DESCRIPTION_MAX_LENGTH,
  JOB_SHORT_TEXT_MAX_LENGTH,
  JOB_MAX_SKILLS,
  JOB_SKILL_MAX_LENGTH,
  JOB_MAX_INTERVIEW_ROUNDS,
  INTERVIEW_ROUND_NAME_MAX_LENGTH,
} = require('../../utils/ats.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the recruiter-facing Job endpoints. organization_id and created_by
 * are always derived from the token, never the body.
 *
 * Interview rounds are supplied as a simple ordered list of { name } (or {key,name});
 * the service normalizes keys/order so clients can't send an inconsistent pipeline.
 */

const skillsList = Joi.array()
  .items(Joi.string().trim().min(1).max(JOB_SKILL_MAX_LENGTH))
  .max(JOB_MAX_SKILLS)
  .unique((a, b) => a.toLowerCase() === b.toLowerCase());

// One interview round on input: name is required; key/order are optional (the service
// derives a stable key and sequential order). Extra keys stripped.
const interviewRound = Joi.object({
  key: Joi.string().trim().min(1).max(60),
  name: Joi.string().trim().min(1).max(INTERVIEW_ROUND_NAME_MAX_LENGTH).required(),
  order: Joi.number().integer().min(1),
}).unknown(false);

const interviewRoundsList = Joi.array()
  .items(interviewRound)
  .max(JOB_MAX_INTERVIEW_ROUNDS);

// Shared money/experience range guards. Cross-field (min<=max) is enforced in the
// service where all values are known together.
const experience = Joi.number().integer().min(0).max(60);
const salary = Joi.number().min(0).precision(2);

const jobBodyBase = {
  title: Joi.string().trim().min(1).max(JOB_TITLE_MAX_LENGTH),
  description: Joi.string().trim().min(1).max(JOB_DESCRIPTION_MAX_LENGTH),
  department: Joi.string().trim().max(JOB_SHORT_TEXT_MAX_LENGTH).allow('', null),
  location: Joi.string().trim().max(JOB_SHORT_TEXT_MAX_LENGTH).allow('', null),
  employment_type: Joi.string().valid(...Object.values(JOB_EMPLOYMENT_TYPES)),
  work_mode: Joi.string().valid(...Object.values(JOB_WORK_MODES)),
  experience_min: experience.allow(null),
  experience_max: experience.allow(null),
  salary_min: salary.allow(null),
  salary_max: salary.allow(null),
  currency: Joi.string()
    .valid(...JOB_CURRENCIES)
    .allow(null),
  salary_period: Joi.string()
    .valid(...Object.values(JOB_SALARY_PERIODS))
    .allow(null),
  show_salary: Joi.boolean(),
  openings: Joi.number().integer().min(1).max(9999),
  skills: skillsList,
  interview_rounds: interviewRoundsList,
};

/**
 * POST /jobs — create a job. action:'publish' opens it immediately; default is draft.
 * title + description are required to create.
 */
const createJob = {
  body: Joi.object().keys({
    ...jobBodyBase,
    title: Joi.string().trim().min(1).max(JOB_TITLE_MAX_LENGTH).required(),
    description: Joi.string().trim().min(1).max(JOB_DESCRIPTION_MAX_LENGTH).required(),
    action: Joi.string().valid('draft', 'publish').default('draft'),
  }),
};

const listJobs = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(JOB_STATUSES)),
        employment_type: Joi.string().valid(...Object.values(JOB_EMPLOYMENT_TYPES)),
        work_mode: Joi.string().valid(...Object.values(JOB_WORK_MODES)),
        department: Joi.string().max(JOB_SHORT_TEXT_MAX_LENGTH),
      })
      .unknown(true),
    // 'mine' restricts to jobs the caller created (default for recruiters anyway).
    scope: Joi.string().valid('mine').optional(),
  }),
};

const getJob = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PUT /jobs/:uuid — edit a job. At least one field required. Editing the pipeline is
 * allowed; the service guards changes that would strand in-progress applications.
 */
const updateJob = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys(jobBodyBase).min(1),
};

/** PATCH /jobs/:uuid/status — publish / close / mark filled / reopen. */
const changeJobStatus = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    status: Joi.string()
      .valid(JOB_STATUSES.OPEN, JOB_STATUSES.CLOSED, JOB_STATUSES.FILLED)
      .required(),
  }),
};

const deleteJob = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  createJob,
  listJobs,
  getJob,
  updateJob,
  changeJobStatus,
  deleteJob,
};
