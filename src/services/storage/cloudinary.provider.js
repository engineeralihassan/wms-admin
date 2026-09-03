const { v2: cloudinary } = require('cloudinary');
const httpStatus = require('http-status');
const StorageProvider = require('./storage-provider.base');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { config } = require('../../config/storage');

/**
 * CloudinaryProvider — stores bytes in Cloudinary and returns a link we persist.
 *
 * Notes on the mapping to our descriptor:
 *  - `key`  = Cloudinary `public_id` (what we keep in DB as storage_key; lets us
 *             delete or re-sign later without parsing URLs).
 *  - `url`  = `secure_url` (https). This is the link the FE renders.
 *
 * We use `resource_type: 'auto'` so images, PDFs and office docs all work through
 * one call. Uploads stream the in-memory buffer directly to Cloudinary — the
 * bytes never touch our disk.
 */
class CloudinaryProvider extends StorageProvider {
  constructor() {
    super();
    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    // Reject both missing AND the scaffolded placeholder values, so a "forgot to set
    // real creds" mistake fails with a clear message instead of a cryptic 401 from
    // Cloudinary's API on the first upload.
    const PLACEHOLDERS = ['your_cloud_name', 'your_api_key', 'your_api_secret'];
    const missing = !cloudName || !apiKey || !apiSecret;
    const placeholder =
      PLACEHOLDERS.includes(cloudName) ||
      PLACEHOLDERS.includes(apiKey) ||
      PLACEHOLDERS.includes(apiSecret);
    if (missing || placeholder) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Cloudinary credentials are not configured. Set real CLOUDINARY_CLOUD_NAME, ' +
          'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in config.DEVELOPMENT.env ' +
          '(get them from your Cloudinary dashboard), then restart the server.'
      );
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    this.deliveryType = config.cloudinary.deliveryType;
  }

  /** Build the folder path this file lives under, e.g. `wms/user-documents`. */
  buildFolder(folder) {
    return [config.rootFolder, folder].filter(Boolean).join('/');
  }

  async upload(file, opts = {}) {
    const folder = this.buildFolder(opts.folder);

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          type: this.deliveryType,
          // Keep a human-readable filename; let Cloudinary de-dupe the public_id.
          use_filename: true,
          unique_filename: true,
          overwrite: false,
          ...(opts.publicId ? { public_id: opts.publicId } : {}),
        },
        (error, uploaded) => {
          if (error) return reject(error);
          return resolve(uploaded);
        }
      );
      stream.end(file.buffer);
    });

    return {
      key: result.public_id,
      url: result.secure_url,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size,
    };
  }

  async remove(key) {
    if (!key) return;
    try {
      // resource_type 'auto' isn't valid for destroy; try image then raw.
      const res = await cloudinary.uploader.destroy(key, { resource_type: 'image' });
      if (res && res.result === 'not found') {
        await cloudinary.uploader.destroy(key, { resource_type: 'raw' });
      }
    } catch (err) {
      // Deletion failures should not break the caller's flow (idempotent cleanup);
      // log for later reconciliation.
      logger.error(`Cloudinary remove failed for key=${key}: ${err.message}`);
    }
  }

  getUrl(key) {
    if (!key) return null;
    return cloudinary.url(key, { secure: true, type: this.deliveryType });
  }
}

module.exports = CloudinaryProvider;
