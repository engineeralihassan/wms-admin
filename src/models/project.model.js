const { DataTypes } = require('sequelize');
const {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_CURRENCIES,
} = require('../utils/project.constants');

/**
 * Project = a tenant-scoped body of work that users are assigned to.
 *
 * Multi-tenancy: every project references organization_id. All queries are scoped by
 * organization at the service layer (via the tenantScope middleware + buildProjectScope),
 * so one tenant can never see another tenant's projects. super_admin (organization_id
 * bypass) is the only actor able to read across organizations.
 *
 * Membership & visibility:
 *   - created_by_id is the owner (usually the org admin who created it).
 *   - lead_id is an optional project lead (must be a member of the project).
 *   - Users are attached through the project_members join table (many-to-many).
 *   - An org manager (project.manage) sees every project in their org; a normal user
 *     sees only projects they are a member of. This overlay lives in the service.
 *
 * Timesheets (future): a timesheet entry will reference project_id; its validity is a
 * single indexed lookup against project_members (project_id, user_id). No change here.
 *
 * Relationships:
 *   Organization 1───* Project          (organization_id)
 *   User(creator) 1──* Project          (created_by_id)
 *   User(lead)    1──* Project          (lead_id, nullable)
 *   Project      *───* User             (through project_members)
 */
module.exports = (sequelize) => {
  const Project = sequelize.define(
    'Project',
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

      // Human-friendly identifier (e.g. "PRJ-000123"). Unique across the platform.
      project_code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor: the organization this project belongs to.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // Who created/owns the project.
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Optional project lead (nullable). Must be a member of the project.
      lead_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 255] },
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 10000] },
      },

      status: {
        type: DataTypes.ENUM(...Object.values(PROJECT_STATUSES)),
        allowNull: false,
        defaultValue: PROJECT_STATUSES.PLANNED,
      },

      priority: {
        type: DataTypes.ENUM(...Object.values(PROJECT_PRIORITIES)),
        allowNull: false,
        defaultValue: PROJECT_PRIORITIES.MEDIUM,
      },

      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      // Budget. DECIMAL(14,2) — never float — so money math is exact. Nullable until set.
      budget: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        validate: { min: 0 },
      },

      currency: {
        type: DataTypes.ENUM(...PROJECT_CURRENCIES),
        allowNull: true,
      },
    },
    {
      tableName: 'projects',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['project_code'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'priority'] },
        { fields: ['organization_id', 'created_by_id'] },
        { fields: ['organization_id', 'lead_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Project;
};
