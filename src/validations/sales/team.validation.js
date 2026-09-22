const Joi = require('joi');
const { TEAM_MEMBER_ROLES, TEAM_NAME_MAX_LENGTH } = require('../../utils/sales.constants');
const { listQuery } = require('../common.validation');

/**
 * Validation for the sales Team endpoints. Users are referenced by public uuid and
 * resolved within the tenant in the service. member_role is the role WITHIN the team.
 */

const memberRole = Joi.string().valid(...Object.values(TEAM_MEMBER_ROLES));

const memberEntry = Joi.object({
  user_uuid: Joi.string().uuid().required(),
  member_role: memberRole,
}).unknown(false);

const createTeam = {
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(TEAM_NAME_MAX_LENGTH).required(),
    lead_user_uuid: Joi.string().uuid().allow(null),
    members: Joi.array().items(memberEntry).max(200),
  }),
};

const getTeam = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updateTeam = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(TEAM_NAME_MAX_LENGTH),
      lead_user_uuid: Joi.string().uuid().allow(null),
    })
    .min(1),
};

const addMember = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object().keys({
    user_uuid: Joi.string().uuid().required(),
    member_role: memberRole,
  }),
};

const removeMember = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
    userUuid: Joi.string().uuid().required(),
  }),
};

const deleteTeam = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

/** GET /sales/members — tenant-scoped user picker (search + paginate). */
const searchMembers = {
  query: Joi.object().keys({ ...listQuery }),
};

module.exports = {
  createTeam,
  getTeam,
  updateTeam,
  addMember,
  removeMember,
  deleteTeam,
  searchMembers,
};
