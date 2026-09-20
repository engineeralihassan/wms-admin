const Joi = require('joi');
const { password } = require('../custom.validation');
// Self-service profile/document schemas live with the user validations (single source
// of truth for the profile shape) and are re-exported here for the /auth/me routes.
const { updateOwnProfile, uploadOwnDocument } = require('../user/user.validation');

// Open self-registration has been intentionally removed. Users are created via:
//  - super_admin -> POST /organizations (creates org + org_admin)
//  - org_admin   -> POST /users (creates vendors/consultants)

const signIn = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required(),
  }),
};

// refreshToken is optional in the body: browsers send it via httpOnly cookie;
// non-browser API clients may still pass it in the body.
const refresh = {
  body: Joi.object().keys({
    refreshToken: Joi.string().optional(),
  }),
};

const logout = {
  body: Joi.object().keys({
    refreshToken: Joi.string().optional(),
  }),
};

const forgotPassword = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
  }),
};

const resetPassword = {
  body: Joi.object().keys({
    token: Joi.string().required(),
    password: Joi.string().required().custom(password),
  }),
};

const verifyActivation = {
  query: Joi.object().keys({
    token: Joi.string().required(),
  }),
};

const activate = {
  body: Joi.object().keys({
    token: Joi.string().required(),
    password: Joi.string().required().custom(password),
  }),
};

// Authenticated self-service password change. The caller must prove they know the
// current password (defense against a hijacked session silently changing it), and
// the new password must meet the same strength rules as every other set-password path.
const changePassword = {
  body: Joi.object().keys({
    current_password: Joi.string().required(),
    new_password: Joi.string().required().custom(password),
  }),
};

module.exports = {
  signIn,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyActivation,
  activate,
  changePassword,
  updateOwnProfile,
  uploadOwnDocument,
};
