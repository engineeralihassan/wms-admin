const httpStatus = require('http-status');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { config, STORAGE_DRIVERS } = require('../../config/storage');
const CloudinaryProvider = require('./cloudinary.provider');
const LocalProvider = require('./local.provider');

/**
 * Provider factory — resolves the single active StorageProvider from config.
 *
 * The instance is lazily created and cached (a provider holds SDK config, so we
 * build it once). This is the ONLY place that knows which concrete backend is in
 * use; everything else depends on the abstract contract.
 */
let instance = null;

const buildProvider = () => {
  switch (config.driver) {
    case STORAGE_DRIVERS.CLOUDINARY:
      logger.info('Storage driver: cloudinary');
      return new CloudinaryProvider();
    case STORAGE_DRIVERS.LOCAL:
      logger.info('Storage driver: local (dev disk storage)');
      return new LocalProvider();
    default:
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Unknown STORAGE_DRIVER "${config.driver}". Use "cloudinary" or "local".`
      );
  }
};

/** Get the active provider (built once, then cached). */
const getProvider = () => {
  if (!instance) {
    instance = buildProvider();
  }
  return instance;
};

module.exports = { getProvider };
