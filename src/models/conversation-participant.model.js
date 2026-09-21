const { DataTypes } = require('sequelize');

/**
 * ConversationParticipant = a user's membership in a conversation.
 *
 * Holds the per-user state that makes unread counts, read receipts, hiding/archiving
 * and muting cheap to read:
 *   - last_read_message_id : the newest message this user has read (drives "seen").
 *   - unread_count         : denormalized badge value (kept in sync on send/read).
 *   - is_hidden            : the user removed the thread from their own list.
 *   - is_platform_admin_view: true on the ORG user's row of a cross-org thread, so the
 *                             UI can flag it as "Platform Admin" without extra joins.
 *
 * Isolation: participancy is the gate for reading a conversation. A conversation is
 * visible only if the caller has a participant row for it — enforced at the service
 * (and socket) layer.
 */
module.exports = (sequelize) => {
  const ConversationParticipant = sequelize.define(
    'ConversationParticipant',
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

      conversation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'conversations', key: 'id' },
        onDelete: 'CASCADE',
      },

      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // The participant's organization at join time (audit + scoping). Null for a
      // super_admin participant.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      last_read_message_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      unread_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      is_hidden: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // True on the org-side participant row of a cross-org thread so the client shows
      // the "Platform Admin" treatment for the counterpart.
      is_platform_admin_view: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      muted_until: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'conversation_participants',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // One membership row per (conversation, user).
        { unique: true, fields: ['conversation_id', 'user_id'] },
        // "My conversations" lookup.
        { fields: ['user_id'] },
        { fields: ['user_id', 'is_hidden'] },
      ],
    }
  );

  return ConversationParticipant;
};
