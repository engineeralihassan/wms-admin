const Joi = require('joi');
const { UPLOAD_FOLDERS } = require('../../config/storage');

/**
 * Validation for the generic file endpoints.
 *
 * NOTE: these schemas validate only the NON-file parts of the request (body /
 * params / query). The files themselves are validated by the multer fileFilter
 * and size/count limits in src/middlewares/upload.js, which runs BEFORE this. The
 * bytes never reach Joi — only their metadata does, once persisted.
 */

const FOLDER_VALUES = Object.values(UPLOAD_FOLDERS);

// POST /files  (multipart) — body carries the owner descriptor alongside the files.
const uploadFiles = {
  body: Joi.object().keys({
    owner_type: Joi.string().max(60).required(),
    // Multipart form fields arrive as strings; coerce to a positive integer.
    owner_id: Joi.number().integer().positive().optional(),
    folder: Joi.string()
      .valid(...FOLDER_VALUES)
      .optional(),
  }),
};

// GET /files/:ownerType/:ownerId
const listForOwner = {
  params: Joi.object().keys({
    ownerType: Joi.string().max(60).required(),
    ownerId: Joi.number().integer().positive().required(),
  }),
};

// DELETE /files/:uuid
const deleteFile = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  uploadFiles,
  listForOwner,
  deleteFile,
};
