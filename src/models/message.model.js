const { DataTypes } = require('sequelize');

/**
 * Message = one text message in a conversation.
 *
 * The integer PK doubles as the natural chronological ordering AND the keyset cursor
 * for history, so "load 30 messages before/after cursor X" is an index range scan on
 * (conversation_id, id) regardless of table size.
 *
 * client_msg_id is an idempotency key supplied by the client so a retried send never
 * creates a duplicate, and the optimistic UI can reconcile its temporary bubble with
 * the persisted row.
 *
 * Retention: messages are SOFT-deleted (deleted_at) by the retention worker after the
 * configured window (default 6 months), preserving audit/recovery.
 *
 * Attachments (future): reuse the polymorphic `attachments` table with
 * owner_type='chat_message', owner_id=message.id — no change to this model needed.
 */
module.exports = (sequelize) => {
  const Message = sequelize.define(
    'Message',
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

      sender_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Denormalized from the conversation for tenant-scoped reporting/cleanup.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      // Plain text in v1 (no HTML). Escaped on render by the client.
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true, len: [1, 4000] },
      },

      // Idempotency + optimistic reconciliation key from the client.
      client_msg_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },

      // Soft delete (retention / moderation).
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'messages',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // The workhorse for keyset history + latest-message lookups.
        { fields: ['conversation_id', 'id'] },
        // Idempotent send: one row per (conversation, client_msg_id).
        { unique: true, fields: ['conversation_id', 'client_msg_id'] },
        // Retention sweep scans by age.
        { fields: ['created_at'] },
      ],
    }
  );

  return Message;
};
