const Joi = require('joi');
const path = require('path');
const {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_MAX_NAME_LENGTH,
  TICKET_ATTACHMENT_ALLOWED_EXTENSIONS,
} = require('../../utils/ticket.constants');
const { listQuery } = require('../common.validation');

/**
 * A single attachment: for now only the file name is accepted/persisted.
 * The name must be non-empty, within length, and have an allowed extension.
 * Extra keys are stripped so clients can't smuggle unexpected fields into the JSON.
 */
const attachment = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(TICKET_ATTACHMENT_MAX_NAME_LENGTH)
    .custom((value, helpers) => {
      const ext = path.extname(value).toLowerCase();
      if (!TICKET_ATTACHMENT_ALLOWED_EXTENSIONS.includes(ext)) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'allowed extension')
    .required(),
}).unknown(false);

const attachmentsList = Joi.array()
  .items(attachment)
  .max(TICKET_ATTACHMENT_MAX_FILES)
  .default([]);

/**
 * POST /tickets — create a ticket.
 * organization_id and created_by are derived from the token, never the body,
 * so the client cannot spoof tenant/creator.
 */
const createTicket = {
  body: Joi.object().keys({
    subject: Joi.string().trim().min(3).max(500).required(),
    description: Joi.string().trim().min(3).max(5000).required(),
    priority: Joi.string()
      .valid(...Object.values(TICKET_PRIORITIES))
      .default(TICKET_PRIORITIES.MEDIUM),
    // Optional: assign at creation time (only honored if the caller may assign).
    assigned_to: Joi.string().uuid().optional(),
    // Attachment metadata only (names). Bytes/storage handled later.
    attachments: attachmentsList,
  }),
};

/**
 * GET /tickets — list with pagination/sort/search plus ticket-specific filters.
 * Filters are allow-listed in TICKET_QUERY_CONFIG; anything else is ignored.
 */
const listTickets = {
  query: Joi.object().keys({
    ...listQuery,
    filters: Joi.object()
      .keys({
        status: Joi.string().valid(...Object.values(TICKET_STATUSES)),
        priority: Joi.string().valid(...Object.values(TICKET_PRIORITIES)),
        created_at_from: Joi.string(),
        created_at_to: Joi.string(),
      })
      .unknown(true),
    // Convenience view selector: 'submitted' (created by me) | 'assigned' (assigned to me).
    scope: Joi.string().valid('submitted', 'assigned').optional(),
  }),
};

const getTicket = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * GET /tickets/:uuid/assignable-users — searchable, paginated picker source.
 */
const listAssignableUsers = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  query: Joi.object().keys(listQuery),
};

/**
 * PUT /tickets/:uuid — update ticket content (subject/description/priority).
 * Who may update which ticket is enforced in the service (own vs. any).
 */
const updateTicket = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object()
    .keys({
      subject: Joi.string().trim().min(3).max(500),
      description: Joi.string().trim().min(3).max(5000),
      priority: Joi.string().valid(...Object.values(TICKET_PRIORITIES)),
    })
    .min(1),
};

/**
 * PATCH /tickets/:uuid/assignee — assign (uuid) or unassign (null) a ticket.
 */
const assignTicket = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    // A user uuid to assign, or null to unassign.
    assigned_to: Joi.string().uuid().allow(null).required(),
  }),
};

/**
 * PATCH /tickets/:uuid/status — change a ticket's status.
 */
const updateStatus = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
  body: Joi.object().keys({
    status: Joi.string()
      .valid(...Object.values(TICKET_STATUSES))
      .required(),
  }),
};

const deleteTicket = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/**
 * POST/GET /tickets/:uuid/attachments — real file upload/list. File type/size/count
 * are enforced by multer (see config/storage); here we only validate the route param.
 */
const ticketAttachments = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
  }),
};

/** DELETE /tickets/:uuid/attachments/:attachmentUuid — remove one uploaded file. */
const deleteTicketAttachment = {
  params: Joi.object().keys({
    uuid: Joi.string().uuid().required(),
    attachmentUuid: Joi.string().uuid().required(),
  }),
};

module.exports = {
  createTicket,
  listTickets,
  getTicket,
  listAssignableUsers,
  updateTicket,
  assignTicket,
  updateStatus,
  deleteTicket,
  ticketAttachments,
  deleteTicketAttachment,
};
