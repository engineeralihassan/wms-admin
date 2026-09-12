const express = require('express');
const validate = require('../../middlewares/validate');
const { userValidation } = require('../../validations');
const userController = require('../../controllers/user/user.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');
const uploadFiles = require('../../middlewares/upload');

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

// Vendors in the caller's org — powers the "select vendor" dropdown for C2C consultants.
// Declared before /:uuid so "vendors" isn't captured as a uuid param.
router
  .route('/vendors')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_READ),
    userController.listVendors
  );

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_READ),
    validate(userValidation.getUser),
    userController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_UPDATE),
    validate(userValidation.updateUser),
    userController.update
  );

// Rich profile (Work / Private / Contract / Settings tabs) upsert.
router
  .route('/:uuid/profile')
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_UPDATE),
    validate(userValidation.updateUserProfile),
    userController.updateProfile
  );

// Structured section lock/unlock (bank_details / work_authorization / emergency_contact).
router
  .route('/:uuid/profile/sections')
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_UPDATE),
    validate(userValidation.setSectionStatus),
    userController.setSectionStatus
  );

// Documents: list the merged checklist; record an uploaded document's metadata.
router
  .route('/:uuid/documents')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_READ),
    validate(userValidation.getUser),
    userController.listDocuments
  )
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_UPDATE),
    // Accept an optional multipart `file` part; the controller pushes it to object
    // storage. Runs before validate() so text fields (doc_type, etc.) reach req.body.
    uploadFiles('file'),
    validate(userValidation.documentUpload),
    userController.uploadDocument
  );

// Admin approves/rejects (locks/unlocks) a single document.
router
  .route('/:uuid/documents/:docUuid/status')
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.USER_UPDATE),
    validate(userValidation.setDocumentStatus),
    userController.setDocumentStatus
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
