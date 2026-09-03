const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { getProvider } = require('./provider.factory');
const { config, UPLOAD_FOLDERS } = require('../../config/storage');

/**
 * file.service — the storage-agnostic core of the upload system.
 *
 * Everything domain-side (user documents, expense receipts, ticket attachments)
 * goes through here, never through a provider directly. Responsibilities:
 *   - normalize multer's THREE different output shapes into one flat file list,
 *   - upload all files to the active provider IN PARALLEL,
 *   - guarantee all-or-nothing semantics: if any upload fails, already-uploaded
 *     objects are removed so we never leave orphans in the store,
 *   - return normalized descriptors ({ key, url, name, mime, size, field }).
 *
 * It deliberately does NOT touch the database — persistence is the caller's job
 * (each domain owns how it records the returned descriptors). That separation is
 * what lets one upload core serve every resource.
 */

/**
 * Flatten whatever multer attached to the request into a single array of files,
 * tagging each with the field it arrived on so callers can route them.
 *
 * Handles all shapes from src/middlewares/upload.js:
 *   - req.file             (single)          -> [ { ...file, field } ]
 *   - req.files = []       (array)           -> [ ...files ]
 *   - req.files = { a:[], b:[] } (fields/any) -> [ ...a, ...b ]
 */
const collectFiles = (req) => {
  const out = [];
  if (req.file) {
    out.push({ ...req.file, field: req.file.fieldname });
  }
  if (Array.isArray(req.files)) {
    req.files.forEach((f) => out.push({ ...f, field: f.fieldname }));
  } else if (req.files && typeof req.files === 'object') {
    Object.keys(req.files).forEach((field) => {
      (req.files[field] || []).forEach((f) => out.push({ ...f, field }));
    });
  }
  return out;
};

/**
 * Upload a batch of in-memory files to the active provider, in parallel.
 * On ANY failure, best-effort removes whatever already landed, then throws.
 *
 * @param {Array} files - normalized files from collectFiles()
 * @param {Object} opts - { folder } logical area (see UPLOAD_FOLDERS)
 * @returns {Promise<Array<{key,url,name,mime,size,field}>>}
 */
const uploadMany = async (files, opts = {}) => {
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No files were provided');
  }
  const folder = opts.folder || UPLOAD_FOLDERS.MISC;
  const provider = getProvider();

  const settled = await Promise.allSettled(
    files.map((file) => provider.upload(file, { folder }).then((d) => ({ ...d, field: file.field })))
  );

  const uploaded = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const failed = settled.filter((s) => s.status === 'rejected');

  if (failed.length > 0) {
    // Roll back the ones that succeeded so we never leave orphaned objects.
    await Promise.allSettled(uploaded.map((d) => provider.remove(d.key)));
    const reason = failed[0].reason;
    const detail = (reason && (reason.message || reason.error || reason)) || 'unknown error';
    logger.error(
      `uploadMany: ${failed.length}/${files.length} uploads failed via "${config.driver}" driver: ${detail}`
    );
    // Surface the real provider error in development so it's diagnosable; keep it
    // generic in production to avoid leaking storage internals to clients.
    const isDev = process.env.NODE_ENV === 'DEVELOPMENT';
    const message = isDev
      ? `File upload failed (${config.driver}): ${detail}`
      : 'One or more files failed to upload. No files were saved; please retry.';
    throw new ApiError(httpStatus.BAD_GATEWAY, message);
  }

  return uploaded;
};

/** Convenience wrapper: read files off the request and upload them. */
const uploadFromRequest = async (req, opts = {}) => {
  const files = collectFiles(req);
  return uploadMany(files, opts);
};

/** Remove one object by key (idempotent). */
const remove = async (key) => {
  const provider = getProvider();
  await provider.remove(key);
};

/** Remove many objects by key, in parallel (best-effort, never throws). */
const removeMany = async (keys = []) => {
  const provider = getProvider();
  await Promise.allSettled(keys.filter(Boolean).map((k) => provider.remove(k)));
};

/** Resolve a (possibly signed) delivery URL for a stored key. */
const getUrl = (key) => getProvider().getUrl(key);

module.exports = {
  collectFiles,
  uploadMany,
  uploadFromRequest,
  remove,
  removeMany,
  getUrl,
  limits: {
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxFiles: config.maxFiles,
    allowedMimeTypes: config.allowedMimeTypes,
  },
};
