const express = require('express');
const validate = require('../../middlewares/validate');
const uploadFiles = require('../../middlewares/upload');
const { fileValidation } = require('../../validations');
const fileController = require('../../controllers/files/file.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Generic, resource-agnostic file API.
 *
 * Middleware order matters:
 *   authVerify -> tenantScope -> requirePermission -> uploadFiles -> validate -> ctrl
 * uploadFiles (multer) runs BEFORE validate so the multipart text fields are parsed
 * into req.body for Joi. `.any()` lets ONE endpoint accept single, multiple, and
 * multi-field uploads without separate routes.
 */

// Expose upload constraints so the FE can validate before sending. (Auth only.)
router.route('/limits').get(authVerify, fileController.limits);

// Upload one or many files (any field layout) and attach them to an owner.
router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.FILE_UPLOAD),
    uploadFiles.any(),
    validate(fileValidation.uploadFiles),
    fileController.upload
  );

// List all attachments for a given owner (tenant-scoped).
router
  .route('/:ownerType/:ownerId')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.FILE_READ),
    validate(fileValidation.listForOwner),
    fileController.listForOwner
  );

// Delete one attachment (removes object in storage + DB row).
router
  .route('/:uuid')
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.FILE_DELETE),
    validate(fileValidation.deleteFile),
    fileController.remove
  );

module.exports = router;
