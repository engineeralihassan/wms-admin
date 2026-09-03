const multer = require('multer');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const { config, ALLOWED_MIME_TYPES } = require('../config/storage');

/**
 * Multipart intake middleware — the ONLY place multer is configured.
 *
 * WHY MEMORY STORAGE: files are held as in-memory buffers and streamed straight
 * to the storage provider (Cloudinary/S3), so nothing hits our disk on the cloud
 * path. This keeps the app stateless and horizontally scalable.
 *
 * ONE FACTORY, EVERY SHAPE: a single `uploadFiles(spec)` covers all three cases
 * the FE needs from one API surface:
 *   - single file:               uploadFiles('avatar')
 *   - many files, one field:     uploadFiles({ name: 'files', maxCount: 10 })
 *   - many files, many fields:   uploadFiles([{ name: 'photos', maxCount: 5 },
 *                                              { name: 'docs',   maxCount: 3 }])
 * or accept anything:            uploadFiles.any()
 *
 * Limits (size / count) and the MIME allow-list come from config/storage.js, so
 * the whole app enforces the same rules. Multer's own errors are mapped to
 * ApiError(400) so they flow through the existing errorHandler consistently.
 */

/** Reject disallowed content types early, before any bytes are buffered fully. */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(
    new ApiError(
      httpStatus.BAD_REQUEST,
      `Unsupported file type "${file.mimetype}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`
    )
  );
};

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSizeBytes,
    files: config.maxFiles,
  },
  fileFilter,
});

/** Translate multer's error codes into user-facing ApiError(400)s. */
const mapMulterError = (err) => {
  if (err instanceof multer.MulterError) {
    const mb = Math.round(config.maxFileSizeBytes / (1024 * 1024));
    const messages = {
      LIMIT_FILE_SIZE: `File too large. Maximum allowed size is ${mb}MB.`,
      LIMIT_FILE_COUNT: `Too many files. Maximum is ${config.maxFiles} per request.`,
      LIMIT_UNEXPECTED_FILE: `Unexpected file field "${err.field}".`,
      LIMIT_PART_COUNT: 'Too many parts in the multipart request.',
    };
    return new ApiError(httpStatus.BAD_REQUEST, messages[err.code] || err.message);
  }
  return err;
};

/** Wrap a multer middleware so its errors become ApiError(400). */
const wrap = (mw) => (req, res, next) =>
  mw(req, res, (err) => (err ? next(mapMulterError(err)) : next()));

/**
 * uploadFiles(spec) — build the right multer handler from a compact spec.
 * @param {string|Object|Array} spec
 *   - string:            field name for a single file (.single)
 *   - { name, maxCount}: one field, up to maxCount files (.array)
 *   - Array<{name,maxCount}>: several fields, each with its own cap (.fields)
 */
const uploadFiles = (spec) => {
  if (typeof spec === 'string') {
    return wrap(multerInstance.single(spec));
  }
  if (Array.isArray(spec)) {
    return wrap(multerInstance.fields(spec));
  }
  if (spec && typeof spec === 'object') {
    return wrap(multerInstance.array(spec.name, spec.maxCount || config.maxFiles));
  }
  throw new Error('uploadFiles(spec): spec must be a string, object, or array');
};

/** Accept any files under any field names (up to the global count/size limits). */
uploadFiles.any = () => wrap(multerInstance.any());

module.exports = uploadFiles;
