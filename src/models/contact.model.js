const { DataTypes } = require('sequelize');

/**
 * Contact = a person you deal with. Optionally attached to an Account.
 *
 * B2B: contacts belong to an Account (account_id set) — e.g. a company's CEO, CTO,
 * procurement manager. B2C: a contact can exist with NO account (account_id null), so a
 * standalone individual customer is a first-class record without a fake company.
 *
 * Visibility is inherited from the parent account's scope when attached, or the owner
 * overlay when standalone — resolved at the service layer.
 *
 * Relationships:
 *   Organization 1───* Contact   (organization_id)
 *   Account      1───* Contact   (account_id, NULLABLE for B2C)
 *   User(owner)  1───* Contact   (owner_id)
 *   Contact      1───* Deal      (contact_id)
 */
module.exports = (sequelize) => {
  const Contact = sequelize.define(
    'Contact',
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

      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // The company this contact belongs to. NULL for B2C / standalone contacts.
      account_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'accounts', key: 'id' },
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

      first_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 150] },
      },

      last_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },

      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      job_title: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      // Marks the primary contact for an account (only one should be true per account;
      // enforced at the service layer, not by a DB constraint, so B2C null-account rows
      // don't collide).
      is_primary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      custom_fields: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: 'contacts',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['account_id'] },
        { fields: ['organization_id', 'owner_id'] },
        { fields: ['organization_id', 'email'] },
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Contact;
};
