const { DataTypes } = require('sequelize');

/**
 * Permission = an atomic capability, keyed as `<resource>.<action>` (e.g. user.create).
 * Seeded from src/config/rbac.js. Endpoints authorize against these, never role names.
 */
module.exports = (sequelize) => {
  const Permission = sequelize.define(
    'Permission',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: 'permissions',
      timestamps: true,
      underscored: true,
      indexes: [{ unique: true, fields: ['key'] }],
    }
  );

  return Permission;
};
