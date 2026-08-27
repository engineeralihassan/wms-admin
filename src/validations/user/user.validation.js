const Joi = require('joi');
const { password } = require('../custom.validation');
const { ORG_ASSIGNABLE_ROLES } = require('../../config/rbac');
const { listQuery } = require('../common.validation');

const createUser = {
  body: Joi.object().keys({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    role: Joi.string()
      .required()
      .valid(...ORG_ASSIGNABLE_ROLES),
    // Only used by super_admin to target a specific org; ignored for org_admin.
    organization_id: Joi.number().integer().optional(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    uuid: Joi.string().required().uuid(),
  }),
};

const listUsers = {
  query: Joi.object().keys(listQuery),
};

module.exports = { createUser, getUser, listUsers };
