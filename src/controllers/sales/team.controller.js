const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { teamService } = require('../../services');

const userSummary = (user) =>
  user
    ? { uuid: user.uuid, first_name: user.first_name, last_name: user.last_name, email: user.email }
    : null;

/** Full team DTO with members (used for get/create/update/member changes). */
const toDto = (t) => ({
  uuid: t.uuid,
  name: t.name,
  team_lead: userSummary(t.teamLead),
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  members: Array.isArray(t.memberships) ? t.memberships.map(teamService.memberSummary) : [],
});

/** Compact team DTO for the list view (member count only). */
const toListDto = (t) => ({
  uuid: t.uuid,
  name: t.name,
  team_lead: userSummary(t.teamLead),
  member_count: Array.isArray(t.memberships) ? t.memberships.length : 0,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
});

/** GET /sales/teams — list teams with member counts. */
const list = catchAsync(async (req, res) => {
  const teams = await teamService.listTeams(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: teams.map(toListDto) });
});

/** GET /sales/members — tenant-scoped active-user picker for team membership. */
const searchMembers = catchAsync(async (req, res) => {
  const { data, meta } = await teamService.searchMembers(req);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map(userSummary),
    meta,
  });
});

/** POST /sales/teams — create a team. */
const create = catchAsync(async (req, res) => {
  const { team } = await teamService.createTeam(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('sales_team_created'), data: toDto(team) });
});

/** GET /sales/teams/:uuid — team with members. */
const getOne = catchAsync(async (req, res) => {
  const { team } = await teamService.getTeamByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_team_found'), data: toDto(team) });
});

/** PATCH /sales/teams/:uuid — update name/lead. */
const update = catchAsync(async (req, res) => {
  const { team } = await teamService.updateTeam(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_team_updated'), data: toDto(team) });
});

/** POST /sales/teams/:uuid/members — add (or re-role) a member. */
const addMember = catchAsync(async (req, res) => {
  const { team } = await teamService.addMember(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_team_member_added'), data: toDto(team) });
});

/** DELETE /sales/teams/:uuid/members/:userUuid — remove a member. */
const removeMember = catchAsync(async (req, res) => {
  const { team } = await teamService.removeMember(req.params.uuid, req.params.userUuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_team_member_removed'), data: toDto(team) });
});

/** DELETE /sales/teams/:uuid — delete a team. */
const remove = catchAsync(async (req, res) => {
  await teamService.deleteTeam(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_team_deleted'), data: null });
});

module.exports = { toDto, toListDto, list, searchMembers, create, getOne, update, addMember, removeMember, remove };
