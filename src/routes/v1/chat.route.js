const express = require('express');
const validate = require('../../middlewares/validate');
const { chatValidation } = require('../../validations');
const chatController = require('../../controllers/chat/chat.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');
const { chatSendRateLimiter } = require('../../middlewares/rate-limit');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check chat permission.
// Isolation to the org boundary is enforced in the service layer via chat.shared.

// Recipient picker (tenant-scoped user search).
router
  .route('/contacts')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.listContacts),
    chatController.listContacts
  );

// Unread badge summary (declared before /conversations/:uuid style paths anyway).
router
  .route('/unread-summary')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    chatController.unreadSummary
  );

// Conversation list + get-or-create direct conversation.
router
  .route('/conversations')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.listConversations),
    chatController.listConversations
  )
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_SEND),
    validate(chatValidation.createConversation),
    chatController.createConversation
  );

// Single conversation metadata + hide/archive.
router
  .route('/conversations/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.conversationParam),
    chatController.getConversation
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.conversationParam),
    chatController.hideConversation
  );

// Message history + send.
router
  .route('/conversations/:uuid/messages')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.listMessages),
    chatController.listMessages
  )
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_SEND),
    chatSendRateLimiter,
    validate(chatValidation.sendMessage),
    chatController.sendMessage
  );

// Mark read.
router
  .route('/conversations/:uuid/read')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CHAT_READ),
    validate(chatValidation.markRead),
    chatController.markRead
  );

module.exports = router;
