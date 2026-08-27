const Joi = require('joi');
const { password } = require('../custom.validation');
const { listQuery } = require('../common.validation');

const listOrganizations = {
  query: Joi.object().keys(listQuery),
};

const createOrganization = {
  body: Joi.object().keys({
    name: Joi.string().required().min(2).max(150),
    admin: Joi.object()
      .keys({
        first_name: Joi.string().required(),
        last_name: Joi.string().required(),
        email: Joi.string().required().email(),
        password: Joi.string().required().custom(password),
      })
      .required(),
  }),
};

module.exports = { createOrganization, listOrganizations };
