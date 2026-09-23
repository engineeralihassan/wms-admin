const express = require('express');
const validate = require('../../middlewares/validate');
const { organizationValidation } = require('../../validations');
const organizationController = require('../../controllers/organization/organization.controller');
const { authVerify, requirePermission } = require('../../middlewares/auth');
const uploadFiles = require('../../middlewares/upload');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Multipart bodies can't carry nested JSON objects, so a logo-bearing create request
 * sends the admin fields flat as admin_first_name / admin_last_name / admin_email.
 * If a nested `admin` object isn't already present, rebuild it from those flat keys
 * (and drop the flat keys) so both JSON and multipart requests hit validation with
 * the same { name, admin } shape.
 */
const normalizeCreateBody = (req, _res, next) => {
  if (req.body && !req.body.admin && (req.body.admin_first_name || req.body.admin_email)) {
    req.body.admin = {
      first_name: req.body.admin_first_name,
      last_name: req.body.admin_last_name,
      email: req.body.admin_email,
    };
    delete req.body.admin_first_name;
    delete req.body.admin_last_name;
    delete req.body.admin_email;
  }
  next();
};

// All organization management is platform-level. The permissions used here
// (organization.create / organization.read_all) belong only to super_admin.
router
  .route('/')
  .post(
    authVerify,
    requirePermission(PERMISSIONS.ORG_CREATE),
    // Optional multipart `logo` image. Runs before validate() so Joi still sees the
    // text fields (multer moves them onto req.body); the file lands on req.file.
    uploadFiles('logo'),
    // When sent as multipart the admin fields arrive flat (admin_first_name, ...).
    // Fold them back into the { admin: {...} } shape Joi/the service expect, so the
    // JSON and multipart paths converge before validation.
    normalizeCreateBody,
    validate(organizationValidation.createOrganization),
    organizationController.create
  )
  .get(
    authVerify,
    requirePermission(PERMISSIONS.ORG_READ_ALL),
    validate(organizationValidation.listOrganizations),
    organizationController.list
  );

// Edit an organization (name / logo). super_admin only. Accepts an optional multipart
// `logo` image; the file lands on req.file and text fields on req.body for Joi.
router.patch(
  '/:uuid',
  authVerify,
  requirePermission(PERMISSIONS.ORG_UPDATE),
  uploadFiles('logo'),
  validate(organizationValidation.updateOrganization),
  organizationController.update
);

// Resend the org admin's activation email (only if they haven't activated yet).
router.post(
  '/:uuid/resend-invite',
  authVerify,
  requirePermission(PERMISSIONS.ORG_UPDATE),
  validate(organizationValidation.resendOrgInvite),
  organizationController.resendInvite
);

router.patch(
  '/:uuid/status',
  authVerify,
  requirePermission(PERMISSIONS.ORG_UPDATE),
  validate(organizationValidation.updateOrganizationStatus),
  organizationController.updateStatus
);

module.exports = router;
