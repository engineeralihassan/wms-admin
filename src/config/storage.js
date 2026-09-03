/**
 * Central configuration for the generic file-upload subsystem.
 *
 * DESIGN GOAL — one place to tune the whole upload pipeline:
 *  - which storage backend the bytes go to (Cloudinary now; S3/local later),
 *  - what the server is willing to accept (mime types, per-file size, count),
 *  - how uploaded objects are namespaced in the remote store.
 *
 * The rest of the system (middleware, providers, services) reads from here so
 * limits/allowed-types never drift across call sites. Everything above the
 * provider layer is storage-agnostic; swapping STORAGE_DRIVER changes only which
 * provider module is loaded, never any caller.
 */

const MB = 1024 * 1024;

/** Supported storage backends. `local` is a zero-config dev fallback. */
const STORAGE_DRIVERS = Object.freeze({
  CLOUDINARY: 'cloudinary',
  LOCAL: 'local',
});

/**
 * Logical "buckets"/folders a file can belong to. Used to namespace objects in
 * the remote store (e.g. Cloudinary folder `wms/user-documents/...`) and to keep
 * a single, reviewable list of what the app stores. Adding a new area is a
 * one-line change here.
 */
const UPLOAD_FOLDERS = Object.freeze({
  USER_DOCUMENTS: 'user-documents',
  EXPENSES: 'expenses',
  TICKETS: 'tickets',
  LEAVES: 'leaves',
  // ATS: candidate CVs / résumés and their supporting documents (public uploads).
  RESUMES: 'resumes',
  MISC: 'misc',
});

/**
 * Allow-list of accepted MIME types. Anything not here is rejected BEFORE it
 * reaches a provider (defense in depth — validation happens in the multer
 * fileFilter and, again, conceptually at the service boundary).
 */
const ALLOWED_MIME_TYPES = Object.freeze([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/plain',
  'text/csv',
]);

const config = Object.freeze({
  /** Active backend. Falls back to `local` so the app runs without cloud creds. */
  driver: process.env.STORAGE_DRIVER || STORAGE_DRIVERS.LOCAL,

  /** Per-file size ceiling (bytes). Enforced by multer AND documented to the FE. */
  maxFileSizeBytes: (Number(process.env.UPLOAD_MAX_FILE_MB) || 10) * MB,

  /** Hard cap on files in a single multipart request (across all fields). */
  maxFiles: Number(process.env.UPLOAD_MAX_FILES) || 10,

  allowedMimeTypes: ALLOWED_MIME_TYPES,

  /** Top-level namespace/prefix for every object this app stores. */
  rootFolder: process.env.UPLOAD_ROOT_FOLDER || 'wms',

  /** Cloudinary credentials (read only when driver === cloudinary). */
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    /** Store originals privately? For signed delivery, set to 'authenticated'. */
    deliveryType: process.env.CLOUDINARY_DELIVERY_TYPE || 'upload',
  },

  /** Local driver: directory (relative to cwd) and public base URL for dev. */
  local: {
    uploadDir: process.env.LOCAL_UPLOAD_DIR || 'uploads',
    publicBaseUrl: process.env.LOCAL_PUBLIC_BASE_URL || `${process.env.DOMAIN || ''}/uploads`,
  },
});

module.exports = {
  config,
  STORAGE_DRIVERS,
  UPLOAD_FOLDERS,
  ALLOWED_MIME_TYPES,
};
