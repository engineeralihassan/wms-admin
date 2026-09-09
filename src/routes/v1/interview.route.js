const express = require('express');
const validate = require('../../middlewares/validate');
const { interviewValidation } = require('../../validations');
const interviewController = require('../../controllers/ats/interview.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Single-interview routes (authenticated). Interviews are LISTED + BOOKED under their
 * application (/applications/:uuid/interviews); here they are addressed directly by
 * their own uuid for read + lifecycle actions (reschedule / cancel / complete).
 * Visibility (own job vs org-wide) is enforced in the service via the parent job.
 */

// Which calendar/meeting providers are available for the UI to offer.
router.get(
  '/providers',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_READ),
  interviewController.listProviders
);

// Read one interview with its participant panel.
router.get(
  '/:uuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_READ),
  validate(interviewValidation.getInterview),
  interviewController.getOne
);

// Move the interview to a new time (re-creates/updates the calendar event).
router.patch(
  '/:uuid/reschedule',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_UPDATE),
  validate(interviewValidation.rescheduleInterview),
  interviewController.reschedule
);

// Cancel the interview (cancels the external event + notifies participants).
router.patch(
  '/:uuid/cancel',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_UPDATE),
  validate(interviewValidation.cancelInterview),
  interviewController.cancel
);

// Mark the interview completed / no-show and record the outcome.
router.patch(
  '/:uuid/complete',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.INTERVIEW_UPDATE),
  validate(interviewValidation.completeInterview),
  interviewController.complete
);

module.exports = router;
