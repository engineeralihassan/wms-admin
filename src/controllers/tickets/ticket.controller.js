const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { ticketService } = require('../../services');

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/** Shape a ticket for API responses (no internal-only fields leaked). */
const toDto = (ticket) => ({
  uuid: ticket.uuid,
  ticket_number: ticket.ticket_number,
  subject: ticket.subject,
  description: ticket.description,
  priority: ticket.priority,
  status: ticket.status,
  // Legacy name-only metadata kept for backward compatibility.
  attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
  // Real uploaded files (bytes in object storage). Populated by the service on reads
  // via setDataValue('ticket_attachments', ...). It is NOT a defined model attribute,
  // so read it from dataValues (getDataValue) instead of plain property access.
  // Each: { uuid, url, file_name, file_mime, file_size, uploaded_at }.
  ticket_attachments:
    (typeof ticket.getDataValue === 'function'
      ? ticket.getDataValue('ticket_attachments')
      : ticket.ticket_attachments) || [],
  resolved_at: ticket.resolved_at,
  closed_at: ticket.closed_at,
  created_at: ticket.createdAt,
  updated_at: ticket.updatedAt,
  created_by: userSummary(ticket.creator),
  assigned_to: userSummary(ticket.assignee),
  organization: ticket.organization
    ? {
        uuid: ticket.organization.uuid,
        name: ticket.organization.name,
        slug: ticket.organization.slug,
      }
    : undefined,
});

/** POST /tickets — any authenticated org member may create. */
const create = catchAsync(async (req, res) => {
  const ticket = await ticketService.createTicket(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('ticket_created'), data: toDto(ticket) });
});

/** GET /tickets — visibility-scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await ticketService.listTickets(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /tickets/:uuid — visibility-scoped fetch. */
const getOne = catchAsync(async (req, res) => {
  const ticket = await ticketService.getTicketByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('ticket_found'), data: toDto(ticket) });
});

/** PUT /tickets/:uuid — update content (own ticket, or any for managers). */
const update = catchAsync(async (req, res) => {
  const ticket = await ticketService.updateTicket(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('ticket_updated'), data: toDto(ticket) });
});

/** PATCH /tickets/:uuid/assignee — assign/unassign (managers only). */
const assign = catchAsync(async (req, res) => {
  const ticket = await ticketService.setAssignee(req.params.uuid, req.body.assigned_to, req, res);
  res.status(httpStatus.OK).send({ message: res.__('ticket_assigned'), data: toDto(ticket) });
});

/**
 * GET /tickets/:uuid/assignable-users — searchable, paginated list of users in the
 * ticket's OWN organization who can be assigned (managers only).
 */
const assignableUsers = catchAsync(async (req, res) => {
  const { data, meta } = await ticketService.listAssignableUsers(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((u) => ({
      uuid: u.uuid,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
    })),
    meta,
  });
});

/** PATCH /tickets/:uuid/status — change status (any for managers, assigned-only for users). */
const updateStatus = catchAsync(async (req, res) => {
  const ticket = await ticketService.updateStatus(req.params.uuid, req.body.status, req, res);
  res
    .status(httpStatus.OK)
    .send({ message: res.__('ticket_status_updated'), data: toDto(ticket) });
});

/** DELETE /tickets/:uuid — delete (ticket.delete permission required). */
const remove = catchAsync(async (req, res) => {
  await ticketService.deleteTicket(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('ticket_deleted'), data: null });
});

/**
 * POST /tickets/:uuid/attachments — upload one or more real files to a ticket.
 * multipart/form-data; the multer middleware on the route parses the files first.
 */
const uploadAttachments = catchAsync(async (req, res) => {
  const data = await ticketService.uploadTicketAttachments(req.params.uuid, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('files_uploaded'), data });
});

/** GET /tickets/:uuid/attachments — list a ticket's uploaded files. */
const listAttachments = catchAsync(async (req, res) => {
  const data = await ticketService.listTicketAttachments(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

/** DELETE /tickets/:uuid/attachments/:attachmentUuid — remove one uploaded file. */
const deleteAttachment = catchAsync(async (req, res) => {
  await ticketService.deleteTicketAttachment(
    req.params.uuid,
    req.params.attachmentUuid,
    req,
    res
  );
  res.status(httpStatus.OK).send({ message: res.__('file_deleted'), data: null });
});

module.exports = {
  create,
  list,
  getOne,
  update,
  assign,
  assignableUsers,
  updateStatus,
  remove,
  uploadAttachments,
  listAttachments,
  deleteAttachment,
};
