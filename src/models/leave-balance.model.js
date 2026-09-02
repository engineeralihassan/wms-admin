const { DataTypes } = require('sequelize');

/**
 * LeaveBalance = a user's leave allocation for one leave type in one period (year).
 * This is the source of truth for "does the user have paid leave available?".
 *
 * A row exists per (organization, user, leave_type, period_year). Days are tracked in
 * three buckets so concurrent requests can't over-commit a balance:
 *   allocated — days granted by an admin.
 *   used      — days consumed by APPROVED requests.
 *   pending   — days held by SUBMITTED (not yet decided) requests.
 * Available = allocated - used - pending (computed, never stored).
 *
 * DECIMAL(6,2) supports fractional days (future half-day leave) with exact math.
 *
 * Relationships:
 *   Organization 1───* LeaveBalance         (organization_id)
 *   User         1───* LeaveBalance          (user_id — the balance owner)
 *   LeaveType    1───* LeaveBalance          (leave_type_id)
 *   LeaveBalance 1───* LeaveBalanceLedger    (audit of every movement)
 */
module.exports = (sequelize) => {
  const LeaveBalance = sequelize.define(
    'LeaveBalance',
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

      // The user who owns this balance.
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Which leave type this balance is for.
      leave_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'leave_types', key: 'id' },
      },

      // The period this balance covers (calendar year, e.g. 2026).
      period_year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      // Days granted by an admin.
      allocated: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },

      // Days consumed by approved requests.
      used: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },

      // Days held by submitted-but-undecided requests.
      pending: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },

      // Who allocated/last adjusted the balance (audit).
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'leave_balances',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'user_id'] },
        // One balance per user/type/year. Explicit short name so Postgres never
        // truncates it to 63 chars (which breaks idempotent sync re-runs).
        {
          unique: true,
          name: 'leave_balances_org_user_type_year_uq',
          fields: ['organization_id', 'user_id', 'leave_type_id', 'period_year'],
        },
      ],
    }
  );

  return LeaveBalance;
};
