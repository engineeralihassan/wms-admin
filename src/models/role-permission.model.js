const { DataTypes } = require('sequelize');

/**
 * Join table linking roles to permissions (many-to-many).
 * The presence of a row means "this role has this permission".
 */
module.exports = (sequelize) => {
  const RolePermission = sequelize.define(
    'RolePermission',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
      },
      permission_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'permissions', key: 'id' },
        onDelete: 'CASCADE',
      },
    },
    {
      tableName: 'role_permissions',
      timestamps: true,
      underscored: true,
      indexes: [{ unique: true, fields: ['role_id', 'permission_id'] }],
    }
  );

  return RolePermission;
};
