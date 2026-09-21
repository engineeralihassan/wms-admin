const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const conversationService = require('../../services/chat/conversation.service');
const messageService = require('../../services/chat/message.service');

/** Light user shape for API responses. */
const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/**
 * Shape a conversation for the caller. `me` is the caller's user id so we can compute
 * the counterpart, the caller's unread count, and the platform-admin flag.
 */
const conversationToDto = (conversation, meUserId) => {
  const participants = conversation.participants || [];
  const mine = participants.find((p) => p.user_id === meUserId);
  const others = participants.filter((p) => p.user_id !== meUserId);
  const counterpart = others[0];

  return {
    uuid: conversation.uuid,
    type: conversation.type,
    is_platform_admin: conversation.is_platform_admin,
    // The caller's view: does the counterpart appear as the platform admin?
    is_platform_admin_view: mine ? mine.is_platform_admin_view : false,
    unread_count: mine ? mine.unread_count : 0,
    last_read_message_id: mine ? mine.last_read_message_id : null,
    last_message_at: conversation.last_message_at,
    counterpart: counterpart ? userSummary(counterpart.user) : null,
    // For groups later: full participant list.
    participants: participants.map((p) => ({
      ...userSummary(p.user),
      last_read_message_id: p.last_read_message_id,
    })),
    organization: conversation.organization
      ? {
          uuid: conversation.organization.uuid,
          name: conversation.organization.name,
          slug: conversation.organization.slug,
        }
      : null,
  };
};

/** Shape a message for API responses. */
const messageToDto = (message) => ({
  // The numeric id is the chronological sequence within a conversation; exposing it
  // lets the client compute read receipts precisely (compare against a participant's
  // last_read_message_id). It is not sensitive — just an ordering cursor.
  id: message.id,
  uuid: message.uuid,
  conversation_id: message.conversation_id,
  body: message.body,
  client_msg_id: message.client_msg_id || null,
  created_at: message.created_at || message.createdAt,
  sender: userSummary(message.sender),
});

/** GET /chat/contacts — searchable, tenant-scoped recipient picker. */
const listContacts = catchAsync(async (req, res) => {
  const { data, meta } = await conversationService.searchContacts(req);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map(userSummary),
    meta,
  });
});

/** GET /chat/conversations — the caller's conversation list. */
const listConversations = catchAsync(async (req, res) => {
  const { data, meta } = await conversationService.listMyConversations(req);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((c) => conversationToDto(c, req.auth.userId)),
    meta,
  });
});

/** POST /chat/conversations — get-or-create a direct conversation. */
const createConversation = catchAsync(async (req, res) => {
  const conversation = await conversationService.getOrCreateDirect(
    req.body.recipient_uuid,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: conversationToDto(conversation, req.auth.userId),
  });
});

/** GET /chat/conversations/:uuid — conversation metadata. */
const getConversation = catchAsync(async (req, res) => {
  const conversation = await conversationService.loadVisibleConversation(
    req.params.uuid,
    req,
    res
  );
  if (!conversation) {
    return res.status(httpStatus.NOT_FOUND).send({ message: res.__('not_found'), data: null });
  }
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: conversationToDto(conversation, req.auth.userId),
  });
});

/** DELETE /chat/conversations/:uuid — hide/archive from the caller's list. */
const hideConversation = catchAsync(async (req, res) => {
  await conversationService.hideConversation(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: null });
});

/** GET /chat/unread-summary — badge counts. */
const unreadSummary = catchAsync(async (req, res) => {
  const summary = await conversationService.getUnreadSummary(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: summary });
});

/** GET /chat/conversations/:uuid/messages — keyset history. */
const listMessages = catchAsync(async (req, res) => {
  const { data, meta } = await messageService.listMessages(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map(messageToDto),
    meta,
  });
});

/**
 * POST /chat/conversations/:uuid/messages — send a message.
 * Emits the realtime event after commit (wired in Phase 2 via req.app chat emitter).
 */
const sendMessage = catchAsync(async (req, res) => {
  const message = await messageService.sendMessage(req.params.uuid, req.body, req, res);
  const dto = messageToDto(message);

  // Phase 2: fan out over Socket.IO if the emitter is attached to the app.
  const chatEvents = req.app.get('chatEvents');
  if (chatEvents) {
    const recipientIds =
      typeof message.getDataValue === 'function'
        ? message.getDataValue('recipient_user_ids') || []
        : [];
    chatEvents.emitMessageCreated(req.params.uuid, dto, recipientIds);
  }

  res.status(httpStatus.CREATED).send({ message: res.__('success'), data: dto });
});

/** POST /chat/conversations/:uuid/read — mark read up to a message. */
const markRead = catchAsync(async (req, res) => {
  const result = await messageService.markRead(req.params.uuid, req.body.message_uuid, req, res);

  const chatEvents = req.app.get('chatEvents');
  if (chatEvents) {
    chatEvents.emitMessageRead(req.params.uuid, {
      user_uuid: req.auth.uuid,
      last_read_message_id: result.lastReadMessageId,
    });
  }

  res.status(httpStatus.OK).send({ message: res.__('success'), data: null });
});

module.exports = {
  conversationToDto,
  messageToDto,
  listContacts,
  listConversations,
  createConversation,
  getConversation,
  hideConversation,
  unreadSummary,
  listMessages,
  sendMessage,
  markRead,
};
