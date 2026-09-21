const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  sequelize,
  Conversation,
  ConversationParticipant,
  Message,
  User,
  Organization,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { paginate } = require('../../utils/query/paginate');
const { USER_QUERY_CONFIG } = require('../../config/query-configs');
const { assertTenantScoped, buildDmKey, resolveDirectScope } = require('./chat.shared');

/** Light user shape returned to the client (never secrets). */
const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];

/** Only these participant columns are needed for list/detail rendering. */
const PARTICIPANT_ATTRIBUTES = [
  'id',
  'uuid',
  'user_id',
  'organization_id',
  'last_read_message_id',
  'unread_count',
  'is_hidden',
  'is_platform_admin_view',
];

/**
 * Load a conversation the caller is a participant of, or throw 404. This is the core
 * isolation gate: a conversation is visible ONLY to its participants, so a leaked uuid
 * (even cross-org) can never be read by a non-participant.
 *
 * Returns the Conversation with the caller's own participant row eager-loaded as
 * `myParticipant` and the other participant(s) as `participants`.
 */
const loadVisibleConversation = async (uuid, req, res, options = {}) => {
  const { auth } = req;
  const membership = await ConversationParticipant.findOne({
    where: { user_id: auth.userId },
    attributes: ['id', 'conversation_id'],
    include: [
      {
        model: Conversation,
        as: 'conversation',
        where: { uuid },
        required: true,
        attributes: ['id'],
      },
    ],
    transaction: options.transaction,
  });

  if (!membership) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('not_found') || 'Conversation not found');
  }

  const conversation = await Conversation.findByPk(membership.conversation_id, {
    include: [
      {
        model: ConversationParticipant,
        as: 'participants',
        attributes: PARTICIPANT_ATTRIBUTES,
        include: [{ model: User, as: 'user', attributes: USER_SUMMARY_ATTRIBUTES }],
      },
      { model: Organization, as: 'organization', attributes: ['uuid', 'name', 'slug'] },
    ],
    transaction: options.transaction,
    lock: options.lock,
  });

  return conversation;
};

/**
 * Get-or-create a direct conversation between the caller and a recipient (by uuid).
 * Idempotent via the unique dm_key: concurrent creates collapse to one row.
 */
const getOrCreateDirect = async (recipientUuid, req, res) => {
  assertTenantScoped(req);
  const { auth } = req;

  const recipient = await User.findOne({
    where: { uuid: recipientUuid },
    attributes: ['id', 'uuid', 'first_name', 'last_name', 'email', 'organization_id', 'status'],
  });

  const { organizationId, isCrossOrg } = resolveDirectScope(auth, recipient, res);
  const dmKey = buildDmKey({
    organizationId,
    isCrossOrg,
    userA: auth.userId,
    userB: recipient.id,
  });

  // Fast path: already exists.
  const existing = await Conversation.findOne({ where: { dm_key: dmKey } });
  if (existing) {
    return loadVisibleConversation(existing.uuid, req, res);
  }

  let created;
  try {
    created = await sequelize.transaction(async (t) => {
      const convo = await Conversation.create(
        {
          type: 'direct',
          organization_id: organizationId,
          is_cross_org: isCrossOrg,
          is_platform_admin: isCrossOrg,
          dm_key: dmKey,
        },
        { transaction: t }
      );

      // Caller's participant row.
      await ConversationParticipant.create(
        {
          conversation_id: convo.id,
          user_id: auth.userId,
          organization_id: auth.organizationId,
          // The caller sees the counterpart as platform-admin only if the caller is
          // the org-side user (i.e. caller is NOT the super admin).
          is_platform_admin_view: isCrossOrg && !auth.isSuperAdmin,
        },
        { transaction: t }
      );

      // Recipient's participant row.
      await ConversationParticipant.create(
        {
          conversation_id: convo.id,
          user_id: recipient.id,
          organization_id: recipient.organization_id,
          // The recipient sees platform-admin treatment when the STARTER is the super
          // admin (recipient is the org-side user).
          is_platform_admin_view: isCrossOrg && auth.isSuperAdmin,
        },
        { transaction: t }
      );

      return convo;
    });
  } catch (err) {
    // Unique dm_key race: another request created it first — load and return that.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const raced = await Conversation.findOne({ where: { dm_key: dmKey } });
      if (raced) return loadVisibleConversation(raced.uuid, req, res);
    }
    throw err;
  }

  return loadVisibleConversation(created.uuid, req, res);
};

/**
 * List the caller's conversations, most-recent first, excluding hidden ones. Returns
 * each conversation with its participants and the caller's unread count. Offset paged.
 */
const listMyConversations = async (req) => {
  assertTenantScoped(req);
  const { auth } = req;
  const limit = Math.min(Number(req.query.limit) || 30, 50);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;

  // The conversations the caller participates in (and hasn't hidden).
  const myMemberships = await ConversationParticipant.findAll({
    where: { user_id: auth.userId, is_hidden: false },
    attributes: ['conversation_id'],
  });
  const ids = myMemberships.map((m) => m.conversation_id);
  if (ids.length === 0) {
    return { data: [], meta: { strategy: 'offset', page, limit, total: 0, totalPages: 1, hasNext: false, hasPrev: false } };
  }

  const { rows, count } = await Conversation.findAndCountAll({
    where: { id: { [Op.in]: ids } },
    order: [['last_message_at', 'DESC NULLS LAST'], ['id', 'DESC']],
    limit,
    offset,
    distinct: true,
    include: [
      {
        model: ConversationParticipant,
        as: 'participants',
        attributes: PARTICIPANT_ATTRIBUTES,
        include: [{ model: User, as: 'user', attributes: USER_SUMMARY_ATTRIBUTES }],
      },
      { model: Organization, as: 'organization', attributes: ['uuid', 'name', 'slug'] },
    ],
  });

  const total = Array.isArray(count) ? count.length : count;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data: rows,
    meta: {
      strategy: 'offset',
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

/** Unread summary for badges: total + per-conversation counts. Cheap, single query. */
const getUnreadSummary = async (req) => {
  assertTenantScoped(req);
  const { auth } = req;
  const rows = await ConversationParticipant.findAll({
    where: { user_id: auth.userId, is_hidden: false, unread_count: { [Op.gt]: 0 } },
    attributes: ['conversation_id', 'unread_count'],
    include: [{ model: Conversation, as: 'conversation', attributes: ['uuid'] }],
  });
  const perConversation = rows.map((r) => ({
    conversation_uuid: r.conversation ? r.conversation.uuid : null,
    unread: r.unread_count,
  }));
  const total = perConversation.reduce((sum, r) => sum + r.unread, 0);
  return { total, perConversation };
};

/** Hide/archive a conversation from the caller's own list (soft, per-user). */
const hideConversation = async (uuid, req, res) => {
  assertTenantScoped(req);
  const conversation = await loadVisibleConversation(uuid, req, res);
  const mine = conversation.participants.find((p) => p.user_id === req.auth.userId);
  if (mine) {
    await ConversationParticipant.update(
      { is_hidden: true },
      { where: { id: mine.id } }
    );
  }
  return true;
};

/**
 * Recipient picker: search users the caller may message.
 *   - regular user -> only ACTIVE users in their OWN org (excluding themselves).
 *   - super_admin  -> any ACTIVE user across orgs (optional ?organization filter later).
 * Reuses the safe USER_QUERY_CONFIG allow-list + trigram indexes via paginate.
 */
const searchContacts = async (req) => {
  assertTenantScoped(req);
  const { auth } = req;

  const scopeWhere = { ...req.tenantWhere, status: 'active' };
  // Never return the caller themselves as a contact.
  scopeWhere.id = { [Op.ne]: auth.userId };

  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere,
    attributes: USER_SUMMARY_ATTRIBUTES,
  });
};

module.exports = {
  loadVisibleConversation,
  getOrCreateDirect,
  listMyConversations,
  getUnreadSummary,
  hideConversation,
  searchContacts,
};
