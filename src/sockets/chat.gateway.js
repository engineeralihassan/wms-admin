const { Server } = require('socket.io');
const { socketAuth } = require('./socket-auth');
const { Conversation, ConversationParticipant } = require('../models');
const logger = require('../config/logger');

/**
 * Room naming:
 *   user:<userId>           — every socket auto-joins its own user room. Used to push
 *                             unread-badge updates and "you were added" events to all of
 *                             a user's open tabs/devices.
 *   conversation:<uuid>     — joined when a conversation is opened, ONLY after a
 *                             server-side participancy check. This is the socket-level
 *                             isolation gate: a user can never receive events for a
 *                             conversation they are not part of.
 */
const userRoom = (userId) => `user:${userId}`;
const conversationRoom = (uuid) => `conversation:${uuid}`;

/**
 * Verify the socket's user is a participant of the conversation (by uuid). Returns the
 * conversation id if allowed, or null. Independent of the HTTP request scope so it can
 * run on socket events directly.
 */
const assertParticipant = async (auth, conversationUuid) => {
  const membership = await ConversationParticipant.findOne({
    where: { user_id: auth.userId },
    attributes: ['id', 'conversation_id'],
    include: [
      {
        model: Conversation,
        as: 'conversation',
        where: { uuid: conversationUuid },
        required: true,
        attributes: ['id', 'uuid'],
      },
    ],
  });
  return membership ? membership.conversation_id : null;
};

/**
 * Attach a Socket.IO server to the given HTTP server and return a `chatEvents`
 * emitter the REST layer uses to fan out domain events AFTER a DB commit.
 *
 * @param {http.Server} httpServer  the server returned by app.listen
 * @returns {{ io, chatEvents, close }}
 */
const initChatGateway = (httpServer) => {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  // Authenticate every connection at the handshake.
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const { auth } = socket;
    // Join the personal room for cross-tab badge/notification fan-out.
    socket.join(userRoom(auth.userId));

    // Presence: announce online to the user's own rooms (kept lightweight).
    socket.broadcast.emit('presence:update', { user_uuid: auth.uuid, status: 'online' });

    // Open a conversation room (participancy-checked).
    socket.on('conversation:join', async (payload, ack) => {
      try {
        const uuid = payload && payload.conversation_uuid;
        if (!uuid) return typeof ack === 'function' && ack({ ok: false, error: 'bad_request' });
        const allowed = await assertParticipant(auth, uuid);
        if (!allowed) {
          return typeof ack === 'function' && ack({ ok: false, error: 'forbidden' });
        }
        socket.join(conversationRoom(uuid));
        return typeof ack === 'function' && ack({ ok: true });
      } catch (err) {
        logger.error(`socket conversation:join error: ${err.message}`);
        return typeof ack === 'function' && ack({ ok: false, error: 'server_error' });
      }
    });

    // Leave a conversation room when the user closes the thread.
    socket.on('conversation:leave', (payload) => {
      const uuid = payload && payload.conversation_uuid;
      if (uuid) socket.leave(conversationRoom(uuid));
    });

    // Typing indicator — relayed only to participants of the room (must be joined).
    socket.on('typing:start', (payload) => relayTyping(socket, auth, payload, true));
    socket.on('typing:stop', (payload) => relayTyping(socket, auth, payload, false));

    socket.on('disconnect', () => {
      socket.broadcast.emit('presence:update', { user_uuid: auth.uuid, status: 'offline' });
    });
  });

  const relayTyping = (socket, auth, payload, isTyping) => {
    const uuid = payload && payload.conversation_uuid;
    if (!uuid) return;
    // Only relay if the socket is actually in the room (joined => participancy-checked).
    if (!socket.rooms.has(conversationRoom(uuid))) return;
    socket.to(conversationRoom(uuid)).emit(isTyping ? 'typing:start' : 'typing:stop', {
      conversation_uuid: uuid,
      user_uuid: auth.uuid,
    });
  };

  /**
   * The emitter the REST controllers call AFTER a successful DB commit. Kept separate
   * from socket event handlers so the domain layer never depends on socket internals —
   * it only calls these two well-defined methods (attached via app.set('chatEvents')).
   */
  const chatEvents = {
    /**
     * A new message was persisted. Push it two ways:
     *  1. to the conversation room — recipients who have the thread OPEN get the
     *     message rendered live;
     *  2. to each recipient's personal user room — recipients who DON'T have the thread
     *     open still get a live unread bump (they aren't in the conversation room).
     * `recipientUserIds` are the participants other than the sender.
     */
    emitMessageCreated(conversationUuid, messageDto, recipientUserIds = []) {
      io.to(conversationRoom(conversationUuid)).emit('message:new', {
        conversation_uuid: conversationUuid,
        message: messageDto,
      });
      // Personal-room fan-out for the unread badge (deduped client-side against the
      // room event, so a recipient with the thread open won't double-count).
      for (const userId of recipientUserIds) {
        io.to(userRoom(userId)).emit('conversation:activity', {
          conversation_uuid: conversationUuid,
          message: messageDto,
        });
      }
    },

    /** A participant read the conversation: broadcast the read receipt. */
    emitMessageRead(conversationUuid, payload) {
      io.to(conversationRoom(conversationUuid)).emit('message:read', {
        conversation_uuid: conversationUuid,
        ...payload,
      });
    },

    /** Notify a specific user (all their tabs) — e.g. a new conversation was created. */
    emitToUser(userId, event, payload) {
      io.to(userRoom(userId)).emit(event, payload);
    },
  };

  const close = async () => {
    await new Promise((resolve) => io.close(() => resolve()));
  };

  return { io, chatEvents, close };
};

module.exports = { initChatGateway };
