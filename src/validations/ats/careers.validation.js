const Joi = require('joi');
const {
  APPLICATION_NAME_MAX_LENGTH,
  APPLICATION_COVER_NOTE_MAX_LENGTH,
} = require('../../utils/ats.constants');

/**
 * Validation for the PUBLIC careers endpoints (NO authentication). These are the only
 * ATS schemas that must be extra strict about shape, since the input is untrusted and
 * unauthenticated. The public_token identifies the job; it is an opaque slug.
 *
 * For the apply endpoint the CV/attachments arrive as multipart files (validated by the
 * upload middleware's mime/size/count limits) — here we only validate the text fields.
 */

// A public token is an opaque URL-safe slug (base64url). Keep the charset tight.
const publicToken = Joi.string()
  .trim()
  .min(16)
  .max(64)
  .pattern(/^[A-Za-z0-9_-]+$/);

// GET /careers/:token — render the public job description (or a "not available" state).
const getPublicJob = {
  params: Joi.object().keys({
    token: publicToken.required(),
  }),
};

/**
 * POST /careers/:token/apply — submit an application (multipart: text fields + files).
 * The candidate's identity is captured here; the resume is uploaded alongside.
 */
const applyToJob = {
  params: Joi.object().keys({
    token: publicToken.required(),
  }),
  body: Joi.object().keys({
    candidate_name: Joi.string().trim().min(1).max(APPLICATION_NAME_MAX_LENGTH).required(),
    candidate_email: Joi.string().trim().email().max(255).required(),
    candidate_phone: Joi.string().trim().max(40).allow('', null),
    linkedin_url: Joi.string().trim().uri().max(500).allow('', null),
    portfolio_url: Joi.string().trim().uri().max(500).allow('', null),
    experience_years: Joi.number().min(0).max(80).allow(null),
    cover_note: Joi.string().trim().max(APPLICATION_COVER_NOTE_MAX_LENGTH).allow('', null),
  }),
};

module.exports = {
  getPublicJob,
  applyToJob,
};
