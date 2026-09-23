const { DataTypes } = require('sequelize');

/**
 * Organization = a tenant. All tenant-scoped data references an organization_id.
 * Super admin users have organization_id = null (they belong to the platform).
 */
module.exports = (sequelize) => {
  const Organization = sequelize.define(
    'Organization',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      uuid: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true },
      },
      // URL-friendly unique identifier for the tenant (e.g. "acme-corp").
      slug: {
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Optional brand logo. `logo_url` is the client-facing delivery URL (rendered
      // in the sidebar); `logo_storage_key` is the provider object key, kept so the
      // object can be removed/replaced later without leaking storage internals.
      logo_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },
      logo_storage_key: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },
    },
    {
      tableName: 'organizations',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['slug'] },
        { fields: ['name'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return Organization;
};
