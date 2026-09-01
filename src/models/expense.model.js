const { DataTypes } = require('sequelize');
const {
  EXPENSE_STATUSES,
  EXPENSE_CATEGORIES,
  EXPENSE_CURRENCIES,
  EXPENSE_DEFAULT_CURRENCY,
} = require('../utils/expense.constants');

/**
 * Expense = a tenant-scoped expense/reimbursement claim submitted by a user.
 *
 * Multi-tenancy: every expense references organization_id. All queries are scoped by
 * organization at the service layer (via the tenantScope middleware + buildExpenseScope),
 * so one tenant can never see another tenant's expenses. super_admin is the only actor
 * able to read across organizations.
 *
 * Ownership & workflow:
 *   - created_by_id is the claimant (owner). A normal user only ever sees/edits their
 *     own expenses; a reviewer (expense.review) sees all expenses in their org.
 *   - Lifecycle: draft -> submitted -> approved | rejected (see expense.constants).
 *     Drafts are freely editable by the owner. Once submitted, the owner can no longer
 *     edit (until rejected); a reviewer decides approve/reject.
 *
 * Relationships:
 *   Organization 1───* Expense          (organization_id)
 *   User(creator)  1─* Expense          (created_by_id — who submitted the claim)
 *   User(reviewer) 1─* Expense          (reviewed_by_id — org admin who decided; nullable)
 */
module.exports = (sequelize) => {
  const Expense = sequelize.define(
    'Expense',
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

      // Human-friendly identifier (e.g. "EXP-000123"). Unique across the platform.
      expense_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor: the organization this expense belongs to.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // The claimant / owner of the expense.
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // The reviewer (org admin) who approved/rejected it (nullable until decided).
      reviewed_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      title: {
        type: DataTypes.STRING(500),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 500] },
      },

      category: {
        type: DataTypes.ENUM(...Object.values(EXPENSE_CATEGORIES)),
        allowNull: false,
      },

      // The date the expense was incurred (distinct from created_at/submitted_at).
      expense_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: { len: [0, 5000] },
      },

      // Monetary amount. DECIMAL(14,2) — never float — so currency math is exact.
      amount: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        validate: { min: 0 },
      },

      currency: {
        type: DataTypes.ENUM(...EXPENSE_CURRENCIES),
        allowNull: false,
        defaultValue: EXPENSE_DEFAULT_CURRENCY,
      },

      status: {
        type: DataTypes.ENUM(...Object.values(EXPENSE_STATUSES)),
        allowNull: false,
        defaultValue: EXPENSE_STATUSES.DRAFT,
      },

      // Attachments: metadata only for now (file name). JSONB array of { name }
      // objects; open for future fields (key/size/mime/url) when object storage
      // (S3 presigned URLs) is added — no schema change needed.
      attachments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      // Set when the owner moves the claim from draft -> submitted.
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Set when a reviewer approves or rejects.
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // Required when a reviewer rejects; surfaced back to the owner.
      rejection_reason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
    },
    {
      tableName: 'expenses',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['expense_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'category'] },
        { fields: ['organization_id', 'created_by_id'] },
        { fields: ['organization_id', 'reviewed_by_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
        // Supports filtering/sorting by the incurred date within a tenant.
        { fields: ['organization_id', 'expense_date'] },
      ],
    }
  );

  return Expense;
};
