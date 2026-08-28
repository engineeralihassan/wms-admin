const express = require('express');
const validate = require('../../middlewares/validate');
const { userValidation } = require('../../validations');
const userController = require('../../controllers/user/user.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission.
// tenantScope sets req.tenantWhere so the service auto-filters by organization.
router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_CREATE),
    validate(userValidation.createUser),
    userController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_READ),
    validate(userValidation.listUsers),
    userController.list
  );

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_READ),
    validate(userValidation.getUser),
    userController.getOne
  );

// Secure fallback for granting access: resend the activation invite (never set a
// password on behalf of the user). Requires user.create + tenant/ownership scope.
router
  .route('/:uuid/resend-invite')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_CREATE),
    validate(userValidation.getUser),
    userController.resendInvite
  );

module.exports = router;
