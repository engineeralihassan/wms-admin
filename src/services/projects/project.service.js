const httpStatus = require('http-status');
const { Op, literal } = require('sequelize');
const {
  sequelize,
  Project,
  ProjectMember,
  User,
  Organization,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { PROJECT_QUERY_CONFIG, USER_QUERY_CONFIG } = require('../../config/query-configs');
const { PROJECT_MEMBER_ROLES, PROJECT_STATUSES } = require('../../utils/project.constants');

/** Columns returned for project list/detail. */
const PROJECT_ATTRIBUTES = [
  'id',
  'uuid',
  'project_code',
  'organization_id',
  'created_by_id',
  'lead_id',
  'name',
  'description',
  'status',
  'priority',
  'start_date',
  'end_date',
  'budget',
  'currency',
  'createdAt',
  'updatedAt',
];

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];

/**
 * Associations loaded with a project so the API can show creator/lead + member count.
 * The member count is computed via a correlated subquery so we never load every member
 * just to display a number.
 */
const PROJECT_INCLUDE = [
  { model: User, as: 'creator', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: User, as: 'lead', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
];

/** member_count as a correlated subquery — O(1) per project row, index-backed. */
const memberCountLiteral = () => [
  literal(
    '(SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = "Project"."id")'
  ),
  'member_count',
];

/**
 * The single source of truth for "does this actor manage projects org-wide".
 * project.manage separates an org-level manager (Org Admin) from a normal member:
 * managers see ALL of their org's projects and can add/remove members + set the lead.
 * We check the PERMISSION (not the role name), so any custom role granted
 * project.manage behaves identically — consistent with tickets/expenses.
 */
const isOrgManager = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.PROJECT_MANAGE);

/**
 * Builds the tenant + visibility where-clause for project LIST/READ queries.
 *
 * Visibility rules:
 *   super_admin   -> {}                          (all projects, all orgs)
 *   org manager   -> { organization_id }         (all projects in their org)
 *   normal user   -> { organization_id, id IN (SELECT project_id FROM project_members
 *                     WHERE user_id = me) }       (only projects they're a member of)
 *
 * FAIL-CLOSED: requires the request to have passed through the `tenantScope`
 * middleware. If it hasn't, this throws instead of silently returning unscoped data.
 * Org and user ids come from the signed token, never the request body.
 */
const buildProjectScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }

  const scope = { ...tenantWhere };
  if (!isOrgManager(auth)) {
    // Normal user: only projects they are a member of. Indexed EXISTS-style IN
    // subquery against project_members (user_id, project_id) — O(page), not N+1.
    scope.id = {
      [Op.in]: literal(
        `(SELECT pm.project_id FROM project_members pm WHERE pm.user_id = ${Number(
          auth.userId
        )})`
      ),
    };
  }
  return scope;
};

/**
 * Generate the next human-friendly project code ("PRJ-000123").
 * Derived from the current max id inside a transaction so it stays monotonic;
 * the project_code unique constraint is the ultimate guard against collisions.
 */
const nextProjectCode = async (transaction) => {
  const maxId = (await Project.max('id', { transaction })) || 0;
  return `PRJ-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

/**
 * Resolve a user uuid to a user id, enforcing that the user belongs to the SAME
 * organization as the project (no cross-tenant membership). Returns the user row.
 */
const resolveOrgUser = async (userUuid, organizationId, res) => {
  const user = await User.findOne({
    where: { uuid: userUuid, organization_id: organizationId },
    attributes: ['id', 'uuid', 'first_name', 'last_name', 'email'],
  });
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('project_member_not_found'));
  }
  return user;
};

/**
 * Load a project by uuid within the caller's VISIBILITY scope. Returns null if the
 * caller cannot see it (so callers can turn that into a 404, never leaking existence).
 */
const findVisibleProject = async (uuid, req) =>
  Project.findOne({
    where: { uuid, ...buildProjectScope(req) },
    attributes: { include: [memberCountLiteral()] },
    include: PROJECT_INCLUDE,
  });

/**
 * Create a project. Requires project.create (org admins by policy).
 * organization_id + created_by_id come from the token. The creator is automatically
 * added as a `manager` member so they appear in the project's member list and the
 * membership-based visibility rules stay consistent. Optional initial members
 * (member_user_uuids) are validated to be in the same org before being added.
 */
const createProject = async (body, req, res) => {
  const { auth } = req;
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  // Validate any requested initial members belong to this org (same-tenant only).
  const initialUuids = Array.isArray(body.member_user_uuids)
    ? [...new Set(body.member_user_uuids)]
    : [];
  const initialUsers = [];
  for (const uuid of initialUuids) {
    // eslint-disable-next-line no-await-in-loop
    initialUsers.push(await resolveOrgUser(uuid, organizationId, res));
  }

  const project = await sequelize.transaction(async (transaction) => {
    const project_code = await nextProjectCode(transaction);
    const created = await Project.create(
      {
        project_code,
        organization_id: organizationId,
        created_by_id: auth.userId,
        name: body.name,
        description: body.description || null,
        status: body.status || PROJECT_STATUSES.PLANNED,
        priority: body.priority,
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        budget: body.budget ?? null,
        currency: body.currency || null,
      },
      { transaction }
    );

    // Creator is a manager-member of their own project.
    const memberRows = [
      {
        project_id: created.id,
        user_id: auth.userId,
        organization_id: organizationId,
        member_role: PROJECT_MEMBER_ROLES.MANAGER,
        added_by_id: auth.userId,
      },
      // Initial members (skip the creator if they were also listed).
      ...initialUsers
        .filter((u) => u.id !== auth.userId)
        .map((u) => ({
          project_id: created.id,
          user_id: u.id,
          organization_id: organizationId,
          member_role: PROJECT_MEMBER_ROLES.MEMBER,
          added_by_id: auth.userId,
        })),
    ];
    await ProjectMember.bulkCreate(memberRows, { transaction, ignoreDuplicates: true });

    return created;
  });

  return findVisibleProject(project.uuid, req);
};

/**
 * List projects visible to the caller with search/sort/filter/pagination.
 * A convenience `scope=member` selector narrows to projects the caller is a member of
 * (useful for managers who also want their personal project list).
 */
const listProjects = async (req) => {
  const scopeWhere = buildProjectScope(req);

  if (req.query.scope === 'member') {
    scopeWhere.id = {
      [Op.in]: literal(
        `(SELECT pm.project_id FROM project_members pm WHERE pm.user_id = ${Number(
          req.auth.userId
        )})`
      ),
    };
  }

  return paginate(Project, req.query, PROJECT_QUERY_CONFIG, {
    scopeWhere,
    attributes: { include: [memberCountLiteral()] },
    include: PROJECT_INCLUDE,
  });
};

/** Fetch one project by uuid, visibility-scoped. */
const getProjectByUuid = async (uuid, req, res) => {
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }
  return project;
};

/**
 * Update project fields.
 *   - Managers: may update any project in their org.
 *   - Non-managers with project.update: only projects they created.
 * lead_user_uuid (if provided) must resolve to a current member of the project.
 */
const updateProject = async (uuid, body, req, res) => {
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  const canUpdate = isOrgManager(req.auth) || project.created_by_id === req.auth.userId;
  if (!canUpdate) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  // Resolve/validate the lead if the caller is (re)assigning it.
  if (body.lead_user_uuid !== undefined) {
    if (body.lead_user_uuid === null) {
      project.lead_id = null;
    } else {
      const leadUser = await resolveOrgUser(body.lead_user_uuid, project.organization_id, res);
      const membership = await ProjectMember.findOne({
        where: { project_id: project.id, user_id: leadUser.id },
        attributes: ['id'],
      });
      if (!membership) {
        throw new ApiError(httpStatus.BAD_REQUEST, res.__('project_lead_not_member'));
      }
      project.lead_id = leadUser.id;
    }
  }

  const updatable = [
    'name',
    'description',
    'status',
    'priority',
    'start_date',
    'end_date',
    'budget',
    'currency',
  ];
  updatable.forEach((field) => {
    if (body[field] !== undefined) project[field] = body[field];
  });
  await project.save();

  return findVisibleProject(uuid, req);
};

/**
 * Delete a project. Gated by project.delete at the route; still visibility-scoped so a
 * manager can only delete within their own org. Membership rows are removed with it.
 */
const deleteProject = async (uuid, req, res) => {
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }
  await sequelize.transaction(async (transaction) => {
    await ProjectMember.destroy({ where: { project_id: project.id }, transaction });
    await project.destroy({ transaction });
  });
  return true;
};

/**
 * List a project's members (paginated + searchable by the member's user fields).
 * Access mirrors reading the project: the caller must be able to SEE it.
 */
const listMembers = async (uuid, req, res) => {
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  // Search/sort over the joined user; scope strictly to this project.
  const { rows, count } = await ProjectMember.findAndCountAll({
    where: { project_id: project.id },
    attributes: ['id', 'uuid', 'member_role', 'createdAt'],
    include: [{ model: User, as: 'user', attributes: USER_SUMMARY_ATTRIBUTES }],
    order: [['created_at', 'ASC']],
    distinct: true,
  });

  return { rows, count };
};

/**
 * List org users who can be ADDED to a project: active members of the PROJECT's own
 * organization who are NOT already members. Searchable + paginated server-side, so we
 * never ship "all users" to the client. Manager-only (project.manage at the route).
 */
const listAssignableUsers = async (uuid, req, res) => {
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  const scopeWhere = {
    organization_id: project.organization_id,
    status: 'active',
    // Exclude users already on the project via an indexed NOT IN subquery.
    id: {
      [Op.notIn]: literal(
        `(SELECT pm.user_id FROM project_members pm WHERE pm.project_id = ${Number(
          project.id
        )})`
      ),
    },
  };

  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere,
    attributes: USER_SUMMARY_ATTRIBUTES,
  });
};

/**
 * Add one or more members to a project. Manager-only. Every candidate must belong to
 * the project's own organization (same-tenant only, derived from the project). Existing
 * memberships are skipped (idempotent).
 */
const addMembers = async (uuid, body, req, res) => {
  if (!isOrgManager(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  const uuids = body.user_uuids || (body.user_uuid ? [body.user_uuid] : []);
  const uniqueUuids = [...new Set(uuids)];
  const memberRole = body.member_role || PROJECT_MEMBER_ROLES.MEMBER;

  const users = [];
  for (const userUuid of uniqueUuids) {
    // eslint-disable-next-line no-await-in-loop
    users.push(await resolveOrgUser(userUuid, project.organization_id, res));
  }

  const rows = users.map((u) => ({
    project_id: project.id,
    user_id: u.id,
    organization_id: project.organization_id,
    member_role: memberRole,
    added_by_id: req.auth.userId,
  }));
  await ProjectMember.bulkCreate(rows, { ignoreDuplicates: true });

  return listMembers(uuid, req, res);
};

/**
 * Change a member's role WITHIN the project (manager/member). Manager-only.
 * The creator can always be re-roled by a manager; that's an intentional org decision.
 */
const updateMember = async (uuid, userUuid, memberRole, req, res) => {
  if (!isOrgManager(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  const user = await resolveOrgUser(userUuid, project.organization_id, res);
  const membership = await ProjectMember.findOne({
    where: { project_id: project.id, user_id: user.id },
  });
  if (!membership) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_member_not_found'));
  }

  membership.member_role = memberRole;
  await membership.save();

  return listMembers(uuid, req, res);
};

/**
 * Remove a member from a project. Manager-only. If the removed member was the project
 * lead, the lead is cleared. The project creator cannot be removed (kept as owner).
 */
const removeMember = async (uuid, userUuid, req, res) => {
  if (!isOrgManager(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const project = await findVisibleProject(uuid, req);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_not_found'));
  }

  const user = await resolveOrgUser(userUuid, project.organization_id, res);

  if (user.id === project.created_by_id) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('project_owner_not_removable'));
  }

  const membership = await ProjectMember.findOne({
    where: { project_id: project.id, user_id: user.id },
  });
  if (!membership) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('project_member_not_found'));
  }

  await sequelize.transaction(async (transaction) => {
    await membership.destroy({ transaction });
    if (project.lead_id === user.id) {
      project.lead_id = null;
      await project.save({ transaction });
    }
  });

  return true;
};

/**
 * List projects the caller is a member of (convenience endpoint, e.g. for a "My
 * Projects" view and later the timesheet project picker). Always membership-scoped.
 */
const listMine = async (req) => {
  const scopeWhere = {
    ...req.tenantWhere,
    id: {
      [Op.in]: literal(
        `(SELECT pm.project_id FROM project_members pm WHERE pm.user_id = ${Number(
          req.auth.userId
        )})`
      ),
    },
  };

  return paginate(Project, req.query, PROJECT_QUERY_CONFIG, {
    scopeWhere,
    attributes: { include: [memberCountLiteral()] },
    include: PROJECT_INCLUDE,
  });
};

/**
 * Membership check helper — the seam the future Timesheets module will call to
 * validate that a user may log time against a project. Kept here so membership logic
 * stays centralized in one service.
 */
const isProjectMember = async (projectId, userId) => {
  const membership = await ProjectMember.findOne({
    where: { project_id: projectId, user_id: userId },
    attributes: ['id'],
  });
  return !!membership;
};

module.exports = {
  createProject,
  listProjects,
  getProjectByUuid,
  updateProject,
  deleteProject,
  listMembers,
  listAssignableUsers,
  addMembers,
  updateMember,
  removeMember,
  listMine,
  buildProjectScope,
  isOrgManager,
  isProjectMember,
};
