const Joi = require('joi');
const { listQuery } = require('../common.validation');

const listOrganizations = {
  query: Joi.object().keys(listQuery),
};

// No admin password: the org admin is invited and sets their own password via the
// activation email link.
const createOrganization = {
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(150),
    admin: Joi.object()
      .keys({
        first_name: Joi.string().required(),
        last_name: Joi.string().required(),
        email: Joi.string().required().email(),
      })
      .required(),
  }),
};

const updateOrganizationStatus = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({ is_active: Joi.boolean().required() }),
};

module.exports = { createOrganization, listOrganizations, updateOrganizationStatus };
