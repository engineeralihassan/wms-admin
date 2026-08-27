const { DataTypes } = require('sequelize');
const { ROLE_SCOPES } = require('../config/rbac');

/**
 * Role = a named bundle of permissions (resolved via role_permissions).
 *
 *  - System roles (super_admin, org_admin, vendor, consultant_*) are seeded and shared.
 *  - `scope` = 'platform' (super_admin) or 'organization'.
 *  - `organization_id` is set only for CUSTOM roles a specific org creates later;
 *    system roles have organization_id = null and are reusable across all orgs.
 *  - `is_system` protects built-in roles from being edited/deleted via the API.
 */
module.exports = (sequelize) => {
  const Role = sequelize.define(
    'Role',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      key: {
        type: DataTypes.STRING(60),
        allowNull: false,
        validate: { notEmpty: true },
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { notEmpty: true },
      },
      scope: {
        type: DataTypes.ENUM,
        values: [ROLE_SCOPES.PLATFORM, ROLE_SCOPES.ORGANIZATION],
        allowNull: false,
        defaultValue: ROLE_SCOPES.ORGANIZATION,
      },
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },
      is_system: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'roles',
      timestamps: true,
      underscored: true,
      indexes: [
        // A role key is unique per organization (and once globally for system roles
        // where organization_id is null).
        { unique: true, fields: ['key', 'organization_id'] },
      ],
    }
  );

  return Role;
};
