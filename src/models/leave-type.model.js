const { DataTypes } = require('sequelize');

/**
 * LeaveType = a per-organization catalog entry describing a kind of leave
 * (e.g. Annual, Sick, Casual, Unpaid). It is a table (not an enum) because
 * organizations differ and a future accrual engine needs per-type configuration.
 *
 * Multi-tenancy: every type references organization_id and is scoped by it. Defaults
 * are seeded per organization from DEFAULT_LEAVE_TYPES (see leave.constants.js).
 *
 * The `is_paid` flag drives paid/unpaid behavior; `requires_balance` decides whether
 * submitting a request of this type checks the user's available balance (unpaid leave
 * never checks a balance).
 *
 * Relationships:
 *   Organization 1───* LeaveType     (organization_id)
 *   LeaveType    1───* LeaveRequest  (leave_type_id)
 *   LeaveType    1───* LeaveBalance  (leave_type_id)
 */
module.exports = (sequelize) => {
  const LeaveType = sequelize.define(
    'LeaveType',
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

      // Multi-tenancy anchor.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // Stable machine key, unique per organization (e.g. 'annual', 'unpaid').
      key: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: { notEmpty: true },
      },

      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 100] },
      },

      // Whether leave of this type is paid. Drives the paid/unpaid distinction.
      is_paid: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Whether submitting this leave type checks the user's available balance.
      // Usually equals is_paid; kept explicit so unpaid leave never checks a balance.
      requires_balance: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Optional UI color for the calendar (hex, e.g. '#2563eb').
      color: {
        type: DataTypes.STRING(9),
        allowNull: true,
      },

      // Soft-disable a type without deleting historical requests that reference it.
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Who created the type (audit).
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'leave_types',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { unique: true, fields: ['organization_id', 'key'] },
        { fields: ['organization_id', 'is_active'] },
      ],
    }
  );

  return LeaveType;
};
