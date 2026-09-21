const { DataTypes } = require('sequelize');

/**
 * Conversation = a container for messages between participants.
 *
 * v1 supports `direct` (1:1) conversations; `group` is reserved so the schema does not
 * need to change later. Multi-tenancy: an intra-org conversation carries the shared
 * organization_id; a cross-org conversation (only a super_admin may start one) has
 * organization_id = null and is_cross_org = true.
 *
 * dm_key is a deterministic, unique key for the participant pair (see chat.shared),
 * so we never create two direct conversations for the same two users.
 */
module.exports = (sequelize) => {
  const Conversation = sequelize.define(
    'Conversation',
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
        unique: true,
      },

      // 'direct' (1:1) now; 'group' reserved for future without a migration.
      type: {
        type: DataTypes.ENUM('direct', 'group'),
        allowNull: false,
        defaultValue: 'direct',
      },

      // Tenant anchor. Null for a cross-org (platform-admin) conversation.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      // True when a super_admin messages across organization boundaries. Drives the
      // "Platform Admin" badge shown to the org-side participant.
      is_cross_org: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Convenience mirror of is_cross_org for the UI: the org participant sees this
      // thread as coming from the platform admin.
      is_platform_admin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Deterministic dedupe key for direct conversations. Null for groups.
      dm_key: {
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
      },

      // Denormalized pointers for a fast conversation-list render + sort.
      last_message_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      last_message_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'conversations',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['dm_key'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'last_message_at'] },
      ],
    }
  );

  return Conversation;
};
