const { DataTypes } = require('sequelize');
const { TEAM_MEMBER_ROLES } = require('../utils/sales.constants');

/**
 * SalesTeamMember = the many-to-many join between sales_teams and users.
 *
 * Directly modeled on project_members. organization_id is denormalized onto the join so
 * a membership can never cross tenants (the service always writes the TEAM's org) and
 * team-based queries filter without joining back. member_role is the member's role
 * WITHIN the team (manager/member), independent of their org-level RBAC role.
 *
 * Uniqueness: (team_id, user_id) — a user belongs to a given team at most once.
 *
 * Relationships:
 *   SalesTeam 1───* SalesTeamMember   (team_id)
 *   User      1───* SalesTeamMember   (user_id)
 */
module.exports = (sequelize) => {
  const SalesTeamMember = sequelize.define(
    'SalesTeamMember',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },

      uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        unique: true,
      },

      team_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'sales_teams', key: 'id' },
      },

      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Denormalized tenant anchor (always the team's organization).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      member_role: {
        type: DataTypes.ENUM(...Object.values(TEAM_MEMBER_ROLES)),
        allowNull: false,
        defaultValue: TEAM_MEMBER_ROLES.MEMBER,
      },

      added_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'sales_team_members',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // A user belongs to a given team at most once.
        { unique: true, fields: ['team_id', 'user_id'] },
        { fields: ['team_id'] },
        { fields: ['user_id'] },
        { fields: ['organization_id'] },
        // Powers the "teams a user belongs to" membership lookup / EXISTS subquery.
        { fields: ['user_id', 'team_id'] },
      ],
    }
  );

  return SalesTeamMember;
};
