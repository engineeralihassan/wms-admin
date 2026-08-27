const { DataTypes } = require('sequelize');

/**
 * User belongs to exactly one role and (except for super_admin) one organization.
 *  - organization_id = null  -> platform user (super_admin)
 *  - role_id                 -> resolves the user's permissions
 *  - status                  -> account lifecycle (active/invited/disabled)
 */
module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      uuid: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      first_name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      last_name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true },
      },
      email: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        validate: { isEmail: true, notEmpty: true },
      },
      password: {
        type: DataTypes.STRING(128),
        allowNull: false,
        validate: { notEmpty: true },
      },
      salt: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      // Multi-tenancy: which organization this user belongs to (null for super_admin).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },
      // RBAC: the user's assigned role.
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
      },
      // Ownership hierarchy: the user who "owns"/manages this user.
      // Set when a vendor creates a consultant -> manager_id = that vendor's id.
      // null for org_admins, vendors, and super_admin (they aren't owned by anyone).
      manager_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // Account lifecycle: 'active' can log in; 'invited'/'disabled' cannot (yet).
      status: {
        type: DataTypes.ENUM,
        values: ['active', 'invited', 'disabled'],
        allowNull: false,
        defaultValue: 'active',
      },
      is_login: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Session revocation counter. Access tokens embed the value at issue time;
      // any change here (password reset, role change, disable, forced logout)
      // instantly invalidates every previously-issued access token for this user.
      token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Brute-force protection counters.
      failed_login_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      locked_until: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['email'] },
        { fields: ['organization_id'] },
        { fields: ['role_id'] },
        { fields: ['manager_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
        // Supports sorting/filtering user lists by these columns at scale.
        { fields: ['last_name'] },
        { fields: ['status'] },
      ],
    }
  );

  return User;
};
