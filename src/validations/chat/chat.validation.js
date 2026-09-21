const Joi = require('joi');
const { listQuery } = require('../common.validation');

/** GET /chat/contacts — recipient search (uses the shared list-query shape). */
const listContacts = {
  query: Joi.object().keys({ ...listQuery }),
};

/** GET /chat/conversations — my conversation list. */
const listConversations = {
  query: Joi.object().keys({ ...listQuery }),
};

/** POST /chat/conversations — get-or-create a direct conversation. */
const createConversation = {
  body: Joi.object().keys({
    recipient_uuid: Joi.string().uuid().required(),
  }),
};

/** :uuid path param used by several routes. */
const conversationParam = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** GET /chat/conversations/:uuid/messages — keyset history. */
const listMessages = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys({ ...listQuery }),
};

/** POST /chat/conversations/:uuid/messages — send a text message. */
const sendMessage = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    body: Joi.string().trim().min(1).max(4000).required(),
    // Idempotency + optimistic reconciliation key from the client.
    client_msg_id: Joi.string().max(80).optional(),
  }),
};

/** POST /chat/conversations/:uuid/read — mark read up to a message. */
const markRead = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    // Optional: omit to mark the whole conversation read (up to latest).
    message_uuid: Joi.string().uuid().optional(),
  }),
};

module.exports = {
  listContacts,
  listConversations,
  createConversation,
  conversationParam,
  listMessages,
  sendMessage,
  markRead,
};
