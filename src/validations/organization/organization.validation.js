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

// Edit an organization: only `name` and the logo are editable. `slug` and identity
// are intentionally omitted (locked). `remove_logo` clears an existing logo; both
// text fields are optional so a request can update just one thing. On the multipart
// path the `logo` file lands on req.file (not validated by Joi).
const updateOrganization = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({
    name: Joi.string().min(2).max(150),
    remove_logo: Joi.boolean(),
  }),
};

const updateOrganizationStatus = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({ is_active: Joi.boolean().required() }),
};

// Resend the org admin's activation email. Only the org uuid is needed.
const resendOrgInvite = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createOrganization,
  listOrganizations,
  updateOrganization,
  resendOrgInvite,
  updateOrganizationStatus,
};
