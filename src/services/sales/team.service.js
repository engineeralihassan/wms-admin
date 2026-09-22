const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  SalesTeam,
  SalesTeamMember,
  User,
  sequelize,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { USER_QUERY_CONFIG } = require('../../config/query-configs');
const { TEAM_MEMBER_ROLES } = require('../../utils/sales.constants');

/**
 * team.service — sales teams and their members (the project/project_members pattern).
 *
 * A team's members are existing platform Users joined through sales_team_members; there
 * is no separate "salesperson" entity. Teams are tenant-scoped by req.tenantWhere; read
 * is gated by sales_team.read and mutations by sales_team.manage at the route. member_role
 * is the role WITHIN the team (manager/member), independent of org RBAC.
 */

const memberSummary = (m) => ({
  uuid: m.uuid,
  member_role: m.member_role,
  user: m.user
    ? {
        uuid: m.user.uuid,
        first_name: m.user.first_name,
        last_name: m.user.last_name,
        email: m.user.email,
      }
    : null,
});

/**
 * Searchable, tenant-scoped picker of active users the caller may add to a team. Reuses
 * the safe USER_QUERY_CONFIG allow-list + trigram indexes via paginate (same shape as the
 * chat recipient picker). Gated by sales_team.read at the route.
 */
const searchMembers = async (req) => {
  const scopeWhere = { ...req.tenantWhere, status: 'active' };
  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere,
    attributes: ['uuid', 'first_name', 'last_name', 'email'],
  });
};

/** Resolve a user by public uuid within the caller's tenant, or throw 404. */
const resolveOrgUserId = async (userUuid, req, res, transaction) => {
  const user = await User.findOne({
    where: { uuid: userUuid, ...req.tenantWhere },
    attributes: ['id'],
    transaction,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_owner_not_found'));
  }
  return user.id;
};

/** List teams (tenant scoped) with their member count. */
const listTeams = async (req) => {
  const teams = await SalesTeam.findAll({
    where: { ...req.tenantWhere },
    include: [
      { model: User, as: 'teamLead', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
      { model: SalesTeamMember, as: 'memberships', attributes: ['id'] },
    ],
    order: [['created_at', 'DESC']],
  });
  return teams;
};

/** Fetch a team the caller may see, with its members, or throw 404. */
const findVisibleTeam = async (uuid, req, res, transaction) => {
  const team = await SalesTeam.findOne({
    where: { uuid, ...req.tenantWhere },
    include: [
      { model: User, as: 'teamLead', attributes: ['uuid', 'first_name', 'last_name', 'email'] },
      {
        model: SalesTeamMember,
        as: 'memberships',
        include: [{ model: User, as: 'user', attributes: ['uuid', 'first_name', 'last_name', 'email'] }],
      },
    ],
    transaction,
  });
  if (!team) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_team_not_found'));
  }
  return team;
};

const getTeamByUuid = async (uuid, req, res) => {
  const team = await findVisibleTeam(uuid, req, res);
  return { team };
};

/** Create a team (optionally with an initial member list + team lead). */
const createTeam = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const team = await sequelize.transaction(async (transaction) => {
    let leadUserId = null;
    if (body.lead_user_uuid) {
      leadUserId = await resolveOrgUserId(body.lead_user_uuid, req, res, transaction);
    }

    const created = await SalesTeam.create(
      {
        organization_id: organizationId,
        created_by_id: req.auth.userId,
        lead_user_id: leadUserId,
        name: body.name,
      },
      { transaction }
    );

    // Optional initial members: [{ user_uuid, member_role }].
    if (Array.isArray(body.members) && body.members.length) {
      for (const m of body.members) {
        // eslint-disable-next-line no-await-in-loop
        const userId = await resolveOrgUserId(m.user_uuid, req, res, transaction);
        // eslint-disable-next-line no-await-in-loop
        await SalesTeamMember.findOrCreate({
          where: { team_id: created.id, user_id: userId },
          defaults: {
            team_id: created.id,
            user_id: userId,
            organization_id: organizationId,
            member_role: m.member_role || TEAM_MEMBER_ROLES.MEMBER,
            added_by_id: req.auth.userId,
          },
          transaction,
        });
      }
    }

    return created;
  });

  return getTeamByUuid(team.uuid, req, res);
};

/** Update a team's name / lead. */
const updateTeam = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const team = await SalesTeam.findOne({
      where: { uuid, ...req.tenantWhere },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!team) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_team_not_found'));
    }
    if (body.name !== undefined) team.name = body.name;
    if (body.lead_user_uuid !== undefined) {
      team.lead_user_id = body.lead_user_uuid
        ? await resolveOrgUserId(body.lead_user_uuid, req, res, transaction)
        : null;
    }
    await team.save({ transaction });
  });
  return getTeamByUuid(uuid, req, res);
};

/** Add a member to a team (idempotent on the (team,user) unique constraint). */
const addMember = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const team = await SalesTeam.findOne({
      where: { uuid, ...req.tenantWhere },
      transaction,
    });
    if (!team) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_team_not_found'));
    }
    const userId = await resolveOrgUserId(body.user_uuid, req, res, transaction);
    const [membership, created] = await SalesTeamMember.findOrCreate({
      where: { team_id: team.id, user_id: userId },
      defaults: {
        team_id: team.id,
        user_id: userId,
        organization_id: team.organization_id,
        member_role: body.member_role || TEAM_MEMBER_ROLES.MEMBER,
        added_by_id: req.auth.userId,
      },
      transaction,
    });
    // If already a member, allow updating their role.
    if (!created && body.member_role && membership.member_role !== body.member_role) {
      membership.member_role = body.member_role;
      await membership.save({ transaction });
    }
  });
  return getTeamByUuid(uuid, req, res);
};

/** Remove a member from a team. */
const removeMember = async (uuid, memberUserUuid, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const team = await SalesTeam.findOne({
      where: { uuid, ...req.tenantWhere },
      transaction,
    });
    if (!team) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_team_not_found'));
    }
    const user = await User.findOne({
      where: { uuid: memberUserUuid, ...req.tenantWhere },
      attributes: ['id'],
      transaction,
    });
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_owner_not_found'));
    }
    await SalesTeamMember.destroy({
      where: { team_id: team.id, user_id: user.id },
      transaction,
    });
  });
  return getTeamByUuid(uuid, req, res);
};

/** Delete a team (its membership rows cascade at the FK / are removed explicitly). */
const deleteTeam = async (uuid, req, res) => {
  const team = await findVisibleTeam(uuid, req, res);
  await sequelize.transaction(async (transaction) => {
    await SalesTeamMember.destroy({ where: { team_id: team.id }, transaction });
    await SalesTeam.destroy({ where: { id: team.id }, transaction });
  });
};

module.exports = {
  memberSummary,
  searchMembers,
  listTeams,
  findVisibleTeam,
  getTeamByUuid,
  createTeam,
  updateTeam,
  addMember,
  removeMember,
  deleteTeam,
};
