const httpStatus = require('http-status');
const { Attachment } = require('../../models');
const ApiError = require('../../utils/ApiError');
const fileService = require('./file.service');
const { config } = require('../../config/storage');

/**
 * attachment.service — records uploaded-file descriptors as polymorphic rows and
 * manages their lifecycle. This is the DB-facing counterpart to file.service:
 *
 *   multipart -> uploadFiles middleware -> file.service.uploadFromRequest (bytes)
 *             -> attachment.service.persist (metadata + link row)
 *
 * Every row is tenant-stamped and owner-tagged (owner_type/owner_id) so ANY domain
 * can own files without a new table. Deletion removes the DB row AND the object in
 * the store, so the two never drift.
 */

/** Shape a stored row into the API response DTO (never leaks internal ids/keys). */
const toDto = (a) => ({
  uuid: a.uuid,
  owner_type: a.owner_type,
  field_name: a.field_name,
  url: a.url,
  file_name: a.file_name,
  file_mime: a.file_mime,
  file_size: a.file_size,
  uploaded_at: a.created_at,
});

/**
 * Persist a batch of upload descriptors as attachment rows.
 * @param {Array} descriptors - from file.service (each {key,url,name,mime,size,field})
 * @param {Object} ctx - { ownerType, ownerId, organizationId, uploadedById }
 * @returns {Promise<Array>} created Attachment rows
 */
const persist = async (descriptors, ctx) => {
  const rows = descriptors.map((d) => ({
    owner_type: ctx.ownerType,
    owner_id: ctx.ownerId ?? null,
    organization_id: ctx.organizationId ?? null,
    field_name: d.field || null,
    storage_key: d.key,
    storage_driver: config.driver,
    url: d.url,
    file_name: d.name,
    file_mime: d.mime,
    file_size: d.size,
    uploaded_by_id: ctx.uploadedById ?? null,
  }));
  return Attachment.bulkCreate(rows, { returning: true });
};

/**
 * One-shot: take the files off the request, push bytes to the provider, then
 * record rows. If the DB write fails, the just-uploaded objects are removed so we
 * never leave orphans in the store.
 *
 * @param {Object} req  - Express request (carries req.file/req.files)
 * @param {Object} ctx  - { ownerType, ownerId, organizationId, uploadedById, folder }
 */
const uploadAndPersist = async (req, ctx) => {
  const descriptors = await fileService.uploadFromRequest(req, { folder: ctx.folder });
  try {
    const rows = await persist(descriptors, ctx);
    return rows.map(toDto);
  } catch (err) {
    await fileService.removeMany(descriptors.map((d) => d.key));
    throw err;
  }
};

/** List all attachments for an owner (tenant-scoped). */
const listForOwner = async (ownerType, ownerId, tenantWhere = {}) => {
  const rows = await Attachment.findAll({
    where: { owner_type: ownerType, owner_id: ownerId, ...tenantWhere },
    order: [['created_at', 'DESC']],
  });
  return rows.map(toDto);
};

/**
 * Delete one attachment by uuid (tenant-scoped): removes the object from storage
 * AND the DB row. Throws 404 if the caller can't see it.
 */
const deleteByUuid = async (uuid, tenantWhere = {}) => {
  const row = await Attachment.findOne({ where: { uuid, ...tenantWhere } });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Attachment not found');
  }
  await fileService.remove(row.storage_key);
  await row.destroy();
};

module.exports = {
  toDto,
  persist,
  uploadAndPersist,
  listForOwner,
  deleteByUuid,
};
