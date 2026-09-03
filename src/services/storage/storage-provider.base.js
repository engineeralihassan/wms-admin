/**
 * StorageProvider — the contract every storage backend must satisfy.
 *
 * This is the seam that makes the upload system future-proof: the entire app
 * talks to THIS interface, never to Cloudinary/S3/local directly. Switching
 * backends (Cloudinary -> S3) means adding one new provider class and flipping
 * STORAGE_DRIVER — no controller, service, route, or model changes.
 *
 * A "descriptor" (the normalized return shape of upload) is:
 *   {
 *     key:  string,  // opaque storage key we persist (Cloudinary public_id / S3 key / local path)
 *     url:  string,  // the delivery link we store in the DB and hand to the FE
 *     name: string,  // original filename (for display / download)
 *     mime: string,  // content type
 *     size: number,  // bytes
 *   }
 */
class StorageProvider {
  /**
   * Persist a single file's bytes and return a normalized descriptor.
   * @param {Object} file  - { buffer, originalname, mimetype, size }
   * @param {Object} opts  - { folder, publicId }
   * @returns {Promise<{key:string,url:string,name:string,mime:string,size:number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async upload(file, opts) {
    throw new Error('StorageProvider.upload() not implemented');
  }

  /**
   * Remove a previously stored object by its key. Must be idempotent
   * (removing a non-existent key must not throw).
   * @param {string} key
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async remove(key) {
    throw new Error('StorageProvider.remove() not implemented');
  }

  /**
   * Resolve a delivery URL for a stored key (used when links are signed/expiring
   * and must be minted on demand rather than persisted).
   * @param {string} key
   * @returns {Promise<string>|string}
   */
  // eslint-disable-next-line no-unused-vars
  getUrl(key) {
    throw new Error('StorageProvider.getUrl() not implemented');
  }
}

module.exports = StorageProvider;
