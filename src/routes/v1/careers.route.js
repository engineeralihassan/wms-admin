const express = require('express');
const validate = require('../../middlewares/validate');
const uploadFiles = require('../../middlewares/upload');
const { careersValidation } = require('../../validations');
const careersController = require('../../controllers/ats/careers.controller');
const { careersRateLimiter } = require('../../middlewares/rate-limit');

const router = express.Router();

/**
 * PUBLIC careers routes — NO authentication. This is the candidate-facing surface a
 * recruiter shares: /api/v1/careers/:token renders the job, and .../apply accepts a
 * submission. Because it's unauthenticated it is:
 *   - rate-limited per IP (careersRateLimiter) to blunt spam/scraping,
 *   - routed on the job's unguessable public_token (never an internal id/uuid),
 *   - strict about input shape (careersValidation) and file limits (upload middleware).
 *
 * The apply endpoint runs multer BEFORE validate so the multipart text fields are
 * parsed into req.body for Joi, exactly like the generic /files route. uploadFiles.any()
 * accepts the CV (and a few supporting docs) under any field name.
 */

// View a shared job posting (or a friendly "not accepting / filled" state).
router.get(
  '/:token',
  careersRateLimiter,
  validate(careersValidation.getPublicJob),
  careersController.getPublicJob
);

// Submit an application with a CV (+ optional supporting files).
router.post(
  '/:token/apply',
  careersRateLimiter,
  uploadFiles.any(),
  validate(careersValidation.applyToJob),
  careersController.apply
);

module.exports = router;
