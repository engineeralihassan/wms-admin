const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  sequelize,
  Conversation,
  ConversationParticipant,
  Message,
  User,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { CHAT_MESSAGE_QUERY_CONFIG } = require('../../config/query-configs');
const { assertTenantScoped } = require('./chat.shared');
const { loadVisibleConversation } = require('./conversation.service');

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];
const MESSAGE_ATTRIBUTES = [
  'id',
  'uuid',
  'conversation_id',
  'sender_id',
  'body',
  'client_msg_id',
  'created_at',
];

/**
 * Send a text message into a conversation the caller participates in.
 *
 * Transactional + idempotent:
 *  - re-checks participancy (isolation) before writing;
 *  - if client_msg_id already exists for this conversation, returns the existing row
 *    (safe retries never duplicate);
 *  - inserts the message, updates the conversation's last_message pointers, bumps the
 *    OTHER participant's unread_count, and marks the sender as having read it.
 *
 * Returns the created (or pre-existing) Message with its sender eager-loaded.
 */
const sendMessage = async (conversationUuid, body, req, res) => {
  assertTenantScoped(req);
  const { auth } = req;
  const text = (body.body || '').trim();
  if (!text) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('something_went_wrong'));
  }
  const clientMsgId = body.client_msg_id || null;

  const conversation = await loadVisibleConversation(conversationUuid, req, res);
  if (!conversation) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Conversation not found');
  }

  // Defense in depth: a non-super user can only post into a conversation in their org.
  if (!auth.isSuperAdmin && conversation.organization_id !== auth.organizationId) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Conversation not found');
  }

  // Idempotency short-circuit.
  if (clientMsgId) {
    const dupe = await Message.findOne({
      where: { conversation_id: conversation.id, client_msg_id: clientMsgId },
      attributes: MESSAGE_ATTRIBUTES,
      include: [{ model: User, as: 'sender', attributes: USER_SUMMARY_ATTRIBUTES }],
    });
    if (dupe) return dupe;
  }

  let messageId;
  try {
    messageId = await sequelize.transaction(async (t) => {
      const message = await Message.create(
        {
          conversation_id: conversation.id,
          sender_id: auth.userId,
          organization_id: conversation.organization_id,
          body: text,
          client_msg_id: clientMsgId,
        },
        { transaction: t }
      );

      // Denormalized conversation pointers for fast list rendering + sort.
      await Conversation.update(
        { last_message_id: message.id, last_message_at: message.created_at },
        { where: { id: conversation.id }, transaction: t }
      );

      // Sender has read their own message; unhide the thread for the sender.
      await ConversationParticipant.update(
        { last_read_message_id: message.id, unread_count: 0, is_hidden: false },
        { where: { conversation_id: conversation.id, user_id: auth.userId }, transaction: t }
      );

      // Everyone else in the conversation gets +1 unread and the thread unhidden.
      await ConversationParticipant.increment('unread_count', {
        by: 1,
        where: {
          conversation_id: conversation.id,
          user_id: { [Op.ne]: auth.userId },
        },
        transaction: t,
      });
      await ConversationParticipant.update(
        { is_hidden: false },
        {
          where: { conversation_id: conversation.id, user_id: { [Op.ne]: auth.userId } },
          transaction: t,
        }
      );

      return message.id;
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' && clientMsgId) {
      const raced = await Message.findOne({
        where: { conversation_id: conversation.id, client_msg_id: clientMsgId },
        attributes: MESSAGE_ATTRIBUTES,
        include: [{ model: User, as: 'sender', attributes: USER_SUMMARY_ATTRIBUTES }],
      });
      if (raced) {
        attachRecipients(raced, conversation, auth.userId);
        return raced;
      }
    }
    throw err;
  }

  const created = await Message.findByPk(messageId, {
    attributes: MESSAGE_ATTRIBUTES,
    include: [{ model: User, as: 'sender', attributes: USER_SUMMARY_ATTRIBUTES }],
  });
  // Attach the OTHER participants' user ids (non-persisted) so the controller can fan
  // the event out to each recipient's personal socket room for a live unread bump,
  // even when they don't have the thread open.
  attachRecipients(created, conversation, auth.userId);
  return created;
};

/**
 * Stamp the recipient user ids (everyone except the sender) onto a message instance as
 * a transient dataValue. Used only for realtime fan-out; never serialized to the client.
 */
const attachRecipients = (message, conversation, senderUserId) => {
  const recipientIds = (conversation.participants || [])
    .map((p) => p.user_id)
    .filter((id) => id !== senderUserId);
  message.setDataValue('recipient_user_ids', recipientIds);
};

/**
 * Keyset-paginated message history for a conversation the caller can see. Newest-first
 * by default (sortDir desc); the client reverses for display and pages older with the
 * returned cursor. Excludes soft-deleted (retention) messages.
 */
const listMessages = async (conversationUuid, req, res) => {
  assertTenantScoped(req);
  const conversation = await loadVisibleConversation(conversationUuid, req, res);
  if (!conversation) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Conversation not found');
  }

  const query = { ...req.query };
  if (!query.sortDir) query.sortDir = 'desc'; // newest first

  return paginate(Message, query, CHAT_MESSAGE_QUERY_CONFIG, {
    scopeWhere: { conversation_id: conversation.id, deleted_at: { [Op.is]: null } },
    attributes: MESSAGE_ATTRIBUTES,
    include: [{ model: User, as: 'sender', attributes: USER_SUMMARY_ATTRIBUTES }],
  });
};

/**
 * Mark the conversation read up to a given message (by uuid) for the caller. Resets the
 * caller's unread_count to the number of messages after that point (usually 0). Returns
 * the resolved last_read_message_id so the socket layer can broadcast a read receipt.
 */
const markRead = async (conversationUuid, messageUuid, req, res) => {
  assertTenantScoped(req);
  const { auth } = req;
  const conversation = await loadVisibleConversation(conversationUuid, req, res);
  if (!conversation) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Conversation not found');
  }

  // Resolve the target message; default to the latest message in the conversation.
  let target = null;
  if (messageUuid) {
    target = await Message.findOne({
      where: { uuid: messageUuid, conversation_id: conversation.id },
      attributes: ['id'],
    });
    if (!target) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Message not found');
    }
  } else {
    target = await Message.findOne({
      where: { conversation_id: conversation.id },
      attributes: ['id'],
      order: [['id', 'DESC']],
    });
  }
  const lastReadId = target ? target.id : null;

  // Count remaining unread messages after the read pointer (defensive; usually 0).
  const remaining = lastReadId
    ? await Message.count({
        where: {
          conversation_id: conversation.id,
          id: { [Op.gt]: lastReadId },
          sender_id: { [Op.ne]: auth.userId },
          deleted_at: { [Op.is]: null },
        },
      })
    : 0;

  await ConversationParticipant.update(
    { last_read_message_id: lastReadId, unread_count: remaining },
    { where: { conversation_id: conversation.id, user_id: auth.userId } }
  );

  return { conversationId: conversation.id, conversationUuid, lastReadMessageId: lastReadId };
};

module.exports = {
  sendMessage,
  listMessages,
  markRead,
};
