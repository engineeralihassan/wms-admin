const { DataTypes } = require('sequelize');
const { LEAVE_LEDGER_ENTRY_TYPES } = require('../utils/leave.constants');

/**
 * LeaveBalanceLedger = an immutable audit record of every movement on a leave balance.
 * Written whenever days are allocated, held (submit), consumed (approve), or released
 * (reject/withdraw/cancel). Makes balances fully reconstructable and disputes
 * traceable — we never mutate a ledger row, only append.
 *
 * Relationships:
 *   Organization  1───* LeaveBalanceLedger   (organization_id)
 *   LeaveBalance  1───* LeaveBalanceLedger   (leave_balance_id)
 *   LeaveRequest  1───* LeaveBalanceLedger   (leave_request_id — null for manual allocations)
 */
module.exports = (sequelize) => {
  const LeaveBalanceLedger = sequelize.define(
    'LeaveBalanceLedger',
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

      // The balance this entry moved.
      leave_balance_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'leave_balances', key: 'id' },
      },

      // The request that triggered the movement (null for manual allocations).
      leave_request_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'leave_requests', key: 'id' },
      },

      entry_type: {
        type: DataTypes.ENUM(...Object.values(LEAVE_LEDGER_ENTRY_TYPES)),
        allowNull: false,
      },

      // Signed day movement (e.g. +10 allocation, +2 hold, -2 release).
      amount: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
      },

      // Snapshot of available days after this entry (for fast audit reads).
      balance_after: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: true,
      },

      // The actor who caused the movement (audit).
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'leave_balance_ledger',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['leave_balance_id'] },
        { fields: ['leave_request_id'] },
      ],
    }
  );

  return LeaveBalanceLedger;
};
