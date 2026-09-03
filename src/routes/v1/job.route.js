const express = require('express');
const validate = require('../../middlewares/validate');
const { jobValidation, applicationValidation } = require('../../validations');
const jobController = require('../../controllers/ats/job.controller');
const applicationController = require('../../controllers/ats/application.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Recruiter-facing ATS routes (authenticated). Every route:
 *   authVerify -> tenantScope -> requirePermission -> validate -> controller
 *
 * The service layers the per-role visibility policy on top of tenantScope: a recruiter
 * sees/acts on ONLY their own jobs and those jobs' applications; an org admin (holding
 * job.manage_all) sees the whole org. Applications are nested under their job for
 * listing, and addressed directly by uuid for single-item actions.
 */

// ── Jobs collection ───────────────────────────────────────────────────────────
router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.JOB_CREATE),
    validate(jobValidation.createJob),
    jobController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.JOB_READ),
    validate(jobValidation.listJobs),
    jobController.list
  );

// ── Applications for a specific job (nested list) ──────────────────────────────
router.get(
  '/:uuid/applications',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.APPLICATION_READ),
  validate(applicationValidation.listApplications),
  applicationController.listForJob
);

// ── Single job by uuid ─────────────────────────────────────────────────────────
router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.JOB_READ),
    validate(jobValidation.getJob),
    jobController.getOne
  )
  .put(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.JOB_UPDATE),
    validate(jobValidation.updateJob),
    jobController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.JOB_DELETE),
    validate(jobValidation.deleteJob),
    jobController.remove
  );

// Publish / close / mark filled / reopen a job.
router.patch(
  '/:uuid/status',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.JOB_UPDATE),
  validate(jobValidation.changeJobStatus),
  jobController.changeStatus
);

module.exports = router;
