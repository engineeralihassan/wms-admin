const { DataTypes } = require('sequelize');

/**
 * Account = a company/organization you sell to (the B2B anchor).
 *
 * Container for Contacts and Deals. Created directly, or automatically during lead
 * conversion from the lead's company fields. Tenant-scoped like every other entity;
 * a sales_rep sees only accounts they own, a manager/admin (account.manage_all) sees
 * the whole org.
 *
 * Relationships:
 *   Organization 1───* Account   (organization_id)
 *   User(owner)  1───* Account   (owner_id)
 *   Account      1───* Contact   (account_id)
 *   Account      1───* Deal      (account_id)
 */
module.exports = (sequelize) => {
  const Account = sequelize.define(
    'Account',
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

      account_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      owner_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 200] },
      },

      industry: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      website: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // Structured address kept as JSONB so different countries' formats fit without
      // schema churn: { line1, line2, city, state, postal_code, country }.
      address: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      annual_revenue: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        validate: { min: 0 },
      },

      employee_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },

      account_type: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      custom_fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: 'accounts',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['account_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'owner_id'] },
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Account;
};
