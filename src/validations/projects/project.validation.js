const Joi = require('joi');
const {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_MEMBER_ROLES,
  PROJECT_CURRENCIES,
} = require('../../utils/project.constants');
const { listQuery } = require('../common.validation');

/**
 * POST /projects — create a project.
 * organization_id and created_by are derived from the token, never the body,
 * so the client cannot spoof tenant/creator.
 */
const createProject = {
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(255).required(),
    description: Joi.string().trim().max(10000).allow('', null),
    status: Joi.string()
      .valid(...Object.values(PROJECT_STATUSES))
      .default(PROJECT_STATUSES.PLANNED),
    priority: Joi.string()
      .valid(...Object.values(PROJECT_PRIORITIES))
      .default(PROJECT_PRIORITIES.MEDIUM),
    start_date: Joi.date().iso().allow(null),
    end_date: Joi.date().iso().min(Joi.ref('start_date')).allow(null),
    budget: Joi.number().precision(2).min(0).allow(null),
    currency: Joi.string()
      .valid(...PROJECT_CURRENCIES)
      .allow(null),
    // Optional: seed the project with members at creation time (user uuids).
    member_user_uuids: Joi.array().items(Joi.string().uuid()).max(200).default([]),
  }),
};

/**
 * GET /projects — list with pagination/sort/search plus project-specific filters.
 * Filters are allow-listed in PROJECT_QUERY_CONFIG; anything else is ignored.
 */
const listProjects = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(PROJECT_STATUSES)),
        priority: Joi.string().valid(...Object.values(PROJECT_PRIORITIES)),
        created_at_from: Joi.string(),
        created_at_to: Joi.string(),
      })
      .unknown(true),
    // Convenience view selector: only projects the caller is a member of.
    scope: Joi.string().valid('member').optional(),
  }),
};

const getProject = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * PUT /projects/:uuid — update project fields.
 * Who may update is enforced in the service (manager, or creator).
 */
const updateProject = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(255),
      description: Joi.string().trim().max(10000).allow('', null),
      status: Joi.string().valid(...Object.values(PROJECT_STATUSES)),
      priority: Joi.string().valid(...Object.values(PROJECT_PRIORITIES)),
      start_date: Joi.date().iso().allow(null),
      end_date: Joi.date().iso().allow(null),
      budget: Joi.number().precision(2).min(0).allow(null),
      currency: Joi.string()
        .valid(...PROJECT_CURRENCIES)
        .allow(null),
      // A member's user uuid to set as the project lead, or null to clear.
      lead_user_uuid: Joi.string().uuid().allow(null),
    })
    .min(1),
};

const deleteProject = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** GET /projects/:uuid/members — list a project's members (paginated/searchable). */
const listMembers = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys(listQuery),
};

/** GET /projects/:uuid/assignable-users — org users not yet on the project. */
const listAssignableUsers = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys(listQuery),
};

/**
 * POST /projects/:uuid/members — add one or more members to a project.
 * Accepts either a single user_uuid or an array of user_uuids.
 */
const addMembers = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      user_uuid: Joi.string().uuid(),
      user_uuids: Joi.array().items(Joi.string().uuid()).min(1).max(200),
      member_role: Joi.string()
        .valid(...Object.values(PROJECT_MEMBER_ROLES))
        .default(PROJECT_MEMBER_ROLES.MEMBER),
    })
    .or('user_uuid', 'user_uuids'),
};

/** PATCH /projects/:uuid/members/:userUuid — change a member's role within the project. */
const updateMember = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
    userUuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    member_role: Joi.string()
      .valid(...Object.values(PROJECT_MEMBER_ROLES))
      .required(),
  }),
};

/** DELETE /projects/:uuid/members/:userUuid — remove a member from a project. */
const removeMember = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
    userUuid: Joi.string().uuid().required(),
  }),
};

/** GET /projects/mine — projects the caller is a member of. */
const listMine = {
  query: Joi.object().keys(listQuery),
};

module.exports = {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  listMembers,
  listAssignableUsers,
  addMembers,
  updateMember,
  removeMember,
  listMine,
};
