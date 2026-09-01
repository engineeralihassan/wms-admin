const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { projectService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/** Shape a project for API responses (no internal ids leaked). */
const toDto = (project) => {
  // member_count comes from the correlated subquery alias.
  const memberCount = Number(
    project.get ? project.get('member_count') : project.member_count
  );
  return {
    uuid: project.uuid,
    project_code: project.project_code,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    start_date: project.start_date,
    end_date: project.end_date,
    budget: project.budget,
    currency: project.currency,
    member_count: Number.isNaN(memberCount) ? undefined : memberCount,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    created_by: userSummary(project.creator),
    lead: userSummary(project.lead),
    organization: project.organization
      ? {
          uuid: project.organization.uuid,
          name: project.organization.name,
          slug: project.organization.slug,
        }
      : undefined,
  };
};

/** Shape a project member (join row + its user) for API responses. */
const memberToDto = (member) => ({
  uuid: member.uuid,
  member_role: member.member_role,
  added_at: member.createdAt,
  user: userSummary(member.user),
});

/** POST /projects — create (project.create). Creator becomes a manager member. */
const create = catchAsync(async (req, res) => {
  const project = await projectService.createProject(req.body, req, res);
  res
    .status(httpStatus.CREATED)
    .send({ message: res.__('project_created'), data: toDto(project) });
});

/** GET /projects — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await projectService.listProjects(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /projects/mine — projects the caller is a member of. */
const listMine = catchAsync(async (req, res) => {
  const { data, meta } = await projectService.listMine(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /projects/:uuid — visibility-scoped fetch. */
const getOne = catchAsync(async (req, res) => {
  const project = await projectService.getProjectByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('project_found'), data: toDto(project) });
});

/** PUT /projects/:uuid — update fields (manager, or creator). */
const update = catchAsync(async (req, res) => {
  const project = await projectService.updateProject(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('project_updated'), data: toDto(project) });
});

/** DELETE /projects/:uuid — delete (project.delete). */
const remove = catchAsync(async (req, res) => {
  await projectService.deleteProject(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('project_deleted'), data: null });
});

/** GET /projects/:uuid/members — list a project's members. */
const listMembers = catchAsync(async (req, res) => {
  const { rows } = await projectService.listMembers(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: rows.map(memberToDto),
    meta: { total: rows.length },
  });
});

/** GET /projects/:uuid/assignable-users — org users not yet on the project. */
const assignableUsers = catchAsync(async (req, res) => {
  const { data, meta } = await projectService.listAssignableUsers(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((u) => ({
      uuid: u.uuid,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
    })),
    meta,
  });
});

/** POST /projects/:uuid/members — add member(s) (manager only). */
const addMembers = catchAsync(async (req, res) => {
  const { rows } = await projectService.addMembers(req.params.uuid, req.body, req, res);
  res.status(httpStatus.CREATED).send({
    message: res.__('project_members_added'),
    data: rows.map(memberToDto),
  });
});

/** PATCH /projects/:uuid/members/:userUuid — change a member's project role. */
const updateMember = catchAsync(async (req, res) => {
  const { rows } = await projectService.updateMember(
    req.params.uuid,
    req.params.userUuid,
    req.body.member_role,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('project_member_updated'),
    data: rows.map(memberToDto),
  });
});

/** DELETE /projects/:uuid/members/:userUuid — remove a member (manager only). */
const removeMember = catchAsync(async (req, res) => {
  await projectService.removeMember(req.params.uuid, req.params.userUuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('project_member_removed'), data: null });
});

module.exports = {
  create,
  list,
  listMine,
  getOne,
  update,
  remove,
  listMembers,
  assignableUsers,
  addMembers,
  updateMember,
  removeMember,
};
