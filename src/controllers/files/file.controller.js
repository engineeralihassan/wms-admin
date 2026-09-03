const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const attachmentService = require('../../services/storage/attachment.service');
const fileService = require('../../services/storage/file.service');
const { UPLOAD_FOLDERS } = require('../../config/storage');

/**
 * Generic file controller — one HTTP surface for uploading, listing and deleting
 * attachments for ANY owner resource. The multipart intake shape (single / many /
 * multi-field) is decided by the multer middleware on the route; this controller
 * stays shape-agnostic because file.service normalizes whatever arrived.
 */

/**
 * POST /files
 * Upload one or many files (any field layout) and attach them to a resource.
 * The owner is described in the (already validated) body:
 *   { owner_type: 'expense'|'ticket'|..., owner_id?: number, folder?: string }
 * Returns the created attachment DTOs.
 */
const upload = catchAsync(async (req, res) => {
  const { owner_type: ownerType, owner_id: ownerId, folder } = req.body;

  const data = await attachmentService.uploadAndPersist(req, {
    ownerType,
    ownerId: ownerId != null ? Number(ownerId) : null,
    organizationId: req.auth.organizationId,
    uploadedById: req.auth.userId,
    folder: folder || UPLOAD_FOLDERS.MISC,
  });

  res.status(httpStatus.CREATED).send({ message: res.__('files_uploaded'), data });
});

/**
 * GET /files/:ownerType/:ownerId
 * List every attachment for a given owner, tenant-scoped.
 */
const listForOwner = catchAsync(async (req, res) => {
  const { ownerType, ownerId } = req.params;
  const data = await attachmentService.listForOwner(ownerType, Number(ownerId), req.tenantWhere);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

/**
 * DELETE /files/:uuid
 * Remove one attachment (object in storage + DB row), tenant-scoped.
 */
const remove = catchAsync(async (req, res) => {
  await attachmentService.deleteByUuid(req.params.uuid, req.tenantWhere);
  res.status(httpStatus.OK).send({ message: res.__('file_deleted'), data: null });
});

/**
 * GET /files/limits
 * Expose the server's upload constraints so the FE can validate before sending.
 */
const limits = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).send({ message: res.__('success'), data: fileService.limits });
});

module.exports = {
  upload,
  listForOwner,
  remove,
  limits,
};
