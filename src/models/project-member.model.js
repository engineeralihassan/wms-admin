const { DataTypes } = require('sequelize');
const { PROJECT_MEMBER_ROLES } = require('../utils/project.constants');

/**
 * ProjectMember = the many-to-many join between projects and users.
 *
 * This is the table that makes "a user has many projects and a project has many users"
 * real, AND the table the future Timesheets module validates against: a timesheet entry
 * is only valid if a matching (project_id, user_id) row exists here.
 *
 * organization_id is denormalized onto the join for two reasons:
 *   1. Fast tenant filtering without joining back to projects.
 *   2. It structurally guarantees a membership can never cross tenants — the service
 *      always writes the PROJECT's organization_id here, derived server-side.
 *
 * member_role is the member's role WITHIN the project (manager/member), independent of
 * their org-level RBAC role. A project manager can later approve that project's timesheets.
 *
 * Uniqueness: (project_id, user_id) — a user is a member of a given project at most once.
 */
module.exports = (sequelize) => {
  const ProjectMember = sequelize.define(
    'ProjectMember',
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

      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'projects', key: 'id' },
      },

      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Denormalized tenant anchor (always the project's organization).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      member_role: {
        type: DataTypes.ENUM(...Object.values(PROJECT_MEMBER_ROLES)),
        allowNull: false,
        defaultValue: PROJECT_MEMBER_ROLES.MEMBER,
      },

      // Audit: who added this member (nullable for system/seed inserts).
      added_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'project_members',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // A user can be a member of a project at most once.
        { unique: true, fields: ['project_id', 'user_id'] },
        { fields: ['project_id'] },
        { fields: ['user_id'] },
        { fields: ['organization_id'] },
        // Powers the "projects a user belongs to" membership lookup / EXISTS subquery.
        { fields: ['user_id', 'project_id'] },
      ],
    }
  );

  return ProjectMember;
};
