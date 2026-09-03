const express = require('express');
const validate = require('../../middlewares/validate');
const { applicationValidation } = require('../../validations');
const applicationController = require('../../controllers/ats/application.controller');
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

module.exports = router;
