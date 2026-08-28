const Joi = require('joi');
const { password } = require('../custom.validation');

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

module.exports = {
  signIn,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyActivation,
  activate,
};
