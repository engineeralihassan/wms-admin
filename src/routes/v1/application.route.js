const express = require('express');
const validate = require('../../middlewares/validate');
const { applicationValidation, interviewValidation } = require('../../validations');
const applicationController = require('../../controllers/ats/application.controller');
const interviewController = require('../../controllers/ats/interview.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Recruiter-facing single-application routes (authenticated). Applications are LISTED
 * under their job (/jobs/:uuid/applications); here they are addressed directly by their
 * own uuid for read + workflow actions. Visibility (own job vs org-wide) is enforced in
 * the service via the parent job's ownership.
 *
 * State transitions are PATCH verbs; notes are a POST sub-collection.
 */

// ── Single application by uuid ─────────────────────────────────────────────────
router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.APPLICATION_READ),
    validate(applicationValidation.getApplication),
    applicationController.getOne
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.APPLICATION_DELETE),
    validate(applicationValidation.deleteApplication),
    applicationController.remove
  );

// Move the application through its hiring lifecycle (new -> ... -> hired/rejected).
router.patch(
  '/:uuid/status',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.APPLICATION_UPDATE),
  validate(applicationValidation.changeApplicationStatus),
  applicationController.changeStatus
);

// Set/update the candidate rating (1–5).
router.patch(
  '/:uuid/rating',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.APPLICATION_UPDATE),
  validate(applicationValidation.rateApplication),
  applicationController.rate
);

// Append an internal note.
router.post(
  '/:uuid/notes',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.APPLICATION_UPDATE),
  validate(applicationValidation.addApplicationNote),
  applicationController.addNote
);

// ── Interview scheduling (nested under an application) ──────────────────────────
// Availability + listing + booking are addressed under the parent application; the
// single-interview lifecycle actions live in interview.route.js (/interviews/:uuid/...).

// Org users offered as interviewer options for scheduling (guarded by interview.create,
// NOT user.read, so a recruiter can pick a panel without seeing the Users module).
router.get(
  '/:uuid/interviewers',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_CREATE),
  validate(interviewValidation.listInterviewers),
  interviewController.listInterviewers
);

// Bookable time slots for the application's next interview.
router.get(
  '/:uuid/interviews/availability',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_READ),
  validate(interviewValidation.getAvailability),
  interviewController.getAvailability
);

// List interviews for the application.
router.get(
  '/:uuid/interviews',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_READ),
  validate(interviewValidation.listInterviews),
  interviewController.listForApplication
);

// Schedule a new interview for a shortlisted/interviewing candidate.
router.post(
  '/:uuid/interviews',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_CREATE),
  validate(interviewValidation.scheduleInterview),
  interviewController.schedule
);

module.exports = router;
