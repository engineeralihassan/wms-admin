const express = require('express');
const validate = require('../../middlewares/validate');
const { organizationValidation } = require('../../validations');
const organizationController = require('../../controllers/organization/organization.controller');
const { authVerify, requirePermission } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// All organization management is platform-level. The permissions used here
// (organization.create / organization.read_all) belong only to super_admin.
router
  .route('/')
  .post(
    authVerify,
    requirePermission(PERMISSIONS.ORG_CREATE),
    validate(organizationValidation.createOrganization),
    organizationController.create
  )
  .get(
    authVerify,
    requirePermission(PERMISSIONS.ORG_READ_ALL),
    validate(organizationValidation.listOrganizations),
    organizationController.list
  );

module.exports = router;
