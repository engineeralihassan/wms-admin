const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const StorageProvider = require('./storage-provider.base');
const logger = require('../../config/logger');
const { config } = require('../../config/storage');

/**
 * LocalProvider — a zero-dependency dev/test fallback that writes bytes to disk.
 *
 * It exists so the whole upload pipeline (middleware -> service -> DB metadata)
 * is runnable and testable WITHOUT any cloud credentials. It intentionally mirrors
 * the same descriptor contract as the cloud providers, so nothing above it can
 * tell the difference.
 *
 *  - `key` = relative path under the upload dir (also our storage_key).
 *  - `url` = LOCAL_PUBLIC_BASE_URL + key (served by express.static in dev).
 *
 * NOT for production: no CDN, no redundancy, tied to a single host's disk.
 */
class LocalProvider extends StorageProvider {
  constructor() {
    super();
    this.baseDir = path.resolve(process.cwd(), config.local.uploadDir);
    this.publicBaseUrl = config.local.publicBaseUrl.replace(/\/+$/, '');
  }

  buildFolder(folder) {
    return [config.rootFolder, folder].filter(Boolean).join('/');
  }

  /** Derive a safe, collision-resistant filename that preserves the extension. */
  buildFileName(originalname) {
    const ext = path.extname(originalname || '');
    return `${crypto.randomUUID()}${ext}`;
  }

  async upload(file, opts = {}) {
    const folder = this.buildFolder(opts.folder);
    const fileName = this.buildFileName(file.originalname);
    const relKey = path.posix.join(folder, fileName);
    const absPath = path.join(this.baseDir, folder, fileName);

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.buffer);

    return {
      key: relKey,
      url: `${this.publicBaseUrl}/${relKey}`,
      name: file.originalname,
      mime: file.mimetype,
      size: file.size,
    };
  }

  async remove(key) {
    if (!key) return;
    const absPath = path.join(this.baseDir, key);
    try {
      await fs.unlink(absPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(`Local remove failed for key=${key}: ${err.message}`);
      }
      // ENOENT -> already gone; idempotent, swallow.
    }
  }

  getUrl(key) {
    if (!key) return null;
    return `${this.publicBaseUrl}/${key}`;
  }
}

module.exports = LocalProvider;
