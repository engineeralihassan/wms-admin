const httpStatus = require('http-status');
const { Op } = require('sequelize');
const { sequelize, Ticket, User, Organization } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { TICKET_QUERY_CONFIG, USER_QUERY_CONFIG } = require('../../config/query-configs');
const { TICKET_STATUSES } = require('../../utils/ticket.constants');

/** Columns returned for ticket list/detail. */
const TICKET_ATTRIBUTES = [
  'id',
  'uuid',
  'ticket_number',
  'organization_id',
  'created_by_id',
  'assigned_to_id',
  'subject',
  'description',
  'priority',
  'status',
  'attachments',
  'resolved_at',
  'closed_at',
  'createdAt',
  'updatedAt',
];

const USER_SUMMARY_ATTRIBUTES = ['id', 'uuid', 'first_name', 'last_name', 'email'];

/**
 * Associations loaded with a ticket so the API can show who created/owns it.
 */
const TICKET_INCLUDE = [
  { model: User, as: 'creator', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: User, as: 'assignee', attributes: USER_SUMMARY_ATTRIBUTES },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
];

/**
 * The single source of truth for "does this actor manage tickets org-wide".
 *
 * Per the permission matrix, the capability that separates an org-level manager
 * (Org Admin) from a Normal User is ticket.assign: managers can see ALL of their
 * org's tickets, assign/unassign, change any ticket's status, and edit anyone's
 * ticket. We check the PERMISSION (not the role name) so any custom role granted
 * ticket.assign behaves the same way — consistent with the rest of the codebase.
 */
const isOrgManager = (auth) =>
  auth.isSuperAdmin || (auth.permissions || []).includes(PERMISSIONS.TICKET_ASSIGN);

/**
 * Builds the tenant + visibility where-clause for ticket LIST/READ queries.
 *
 * Visibility rules (from the matrix):
 *   super_admin   -> {}                              (all tickets, all orgs)
 *   org manager   -> { organization_id }             (all tickets in their org)
 *   normal user   -> { organization_id, (created_by_id = me OR assigned_to_id = me) }
 *                    (only tickets they submitted or that are assigned to them)
 *
 * FAIL-CLOSED: requires the request to have passed through the `tenantScope`
 * middleware. If it hasn't, this throws instead of silently returning unscoped data.
 * Org and user ids come from the signed token, never the request body.
 */
const buildTicketScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }

  const scope = { ...tenantWhere };
  if (!isOrgManager(auth)) {
    // Normal user: only tickets they submitted or that are assigned to them.
    scope[Op.or] = [{ created_by_id: auth.userId }, { assigned_to_id: auth.userId }];
  }
  return scope;
};

/**
 * Generate the next human-friendly ticket number ("TKT-000123").
 * Derived from the current max id inside a transaction so it stays monotonic;
 * the ticket_number unique constraint is the ultimate guard against collisions.
 */
const nextTicketNumber = async (transaction) => {
  const maxId = (await Ticket.max('id', { transaction })) || 0;
  return `TKT-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

/**
 * Resolve an assignee uuid to a user id, enforcing that the assignee belongs to the
 * SAME organization as the ticket (no cross-tenant assignment). super_admin is bound
 * to the ticket's org too — you assign within the ticket's tenant, never across.
 */
const resolveAssignee = async (assigneeUuid, organizationId, res) => {
  if (assigneeUuid === null || assigneeUuid === undefined) {
    return null; // explicit unassign
  }
  const assignee = await User.findOne({
    where: { uuid: assigneeUuid, organization_id: organizationId },
    attributes: ['id'],
  });
  if (!assignee) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('assignee_not_found'));
  }
  return assignee.id;
};

/**
 * Load a ticket by uuid within the caller's VISIBILITY scope. Returns null if the
 * caller cannot see it (so callers can turn that into a 404, never leaking existence).
 */
const findVisibleTicket = async (uuid, req) =>
  Ticket.findOne({
    where: { uuid, ...buildTicketScope(req) },
    attributes: TICKET_ATTRIBUTES,
    include: TICKET_INCLUDE,
  });

/**
 * Create a ticket. Every role may create (Create ticket: ✅ ✅ ✅).
 * organization_id + created_by_id come from the token. Optional assignment at
 * creation time is only honored for org managers.
 */
const createTicket = async (body, req, res) => {
  const { auth } = req;
  const { subject, description, priority } = body;

  // Store ONLY the file name for now (no bytes/storage yet). Normalize defensively so
  // only { name } is persisted even if extra keys slip past validation.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((a) => ({ name: String(a.name).trim() }))
    : [];

  // super_admin has no organization of their own; they cannot "submit" into a tenant
  // implicitly. tenantScope already rejects a non-super-admin without an org.
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  // Only managers may pre-assign on create; normal users' assigned_to is ignored.
  let assignedToId = null;
  if (body.assigned_to && isOrgManager(auth)) {
    assignedToId = await resolveAssignee(body.assigned_to, organizationId, res);
  }

  const ticket = await sequelize.transaction(async (transaction) => {
    const ticket_number = await nextTicketNumber(transaction);
    return Ticket.create(
      {
        ticket_number,
        organization_id: organizationId,
        created_by_id: auth.userId,
        assigned_to_id: assignedToId,
        subject,
        description,
        priority,
        attachments,
        status: TICKET_STATUSES.OPEN,
      },
      { transaction }
    );
  });

  return findVisibleTicket(ticket.uuid, req);
};

/**
 * List tickets visible to the caller with search/sort/filter/pagination.
 * A convenience `scope` selector narrows to submitted/assigned-to-me on top of the
 * caller's base visibility.
 */
const listTickets = async (req) => {
  const scopeWhere = buildTicketScope(req);

  if (req.query.scope === 'submitted') {
    scopeWhere.created_by_id = req.auth.userId;
  } else if (req.query.scope === 'assigned') {
    scopeWhere.assigned_to_id = req.auth.userId;
  }

  return paginate(Ticket, req.query, TICKET_QUERY_CONFIG, {
    scopeWhere,
    attributes: TICKET_ATTRIBUTES,
    include: TICKET_INCLUDE,
  });
};

/** Fetch one ticket by uuid, visibility-scoped. */
const getTicketByUuid = async (uuid, req, res) => {
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }
  return ticket;
};

/**
 * Update ticket content (subject/description/priority).
 *   - Managers: may update any ticket in their org (Update another user's ticket ✅).
 *   - Normal user: may update ONLY their own submitted ticket (Update own ticket ✅,
 *     Update another user's ticket ❌).
 */
const updateTicket = async (uuid, body, req, res) => {
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }

  const canUpdate = isOrgManager(req.auth) || ticket.created_by_id === req.auth.userId;
  if (!canUpdate) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  const updatable = ['subject', 'description', 'priority'];
  updatable.forEach((field) => {
    if (body[field] !== undefined) ticket[field] = body[field];
  });
  await ticket.save();

  return findVisibleTicket(uuid, req);
};

/**
 * Assign or unassign a ticket. Manager-only (Assign/Unassign ticket: ✅ ✅ ❌).
 * Route already gates on ticket.assign; this re-checks defensively and enforces
 * the same-organization rule for the assignee.
 */
const setAssignee = async (uuid, assigneeUuid, req, res) => {
  if (!isOrgManager(req.auth)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }

  ticket.assigned_to_id = await resolveAssignee(assigneeUuid, ticket.organization_id, res);
  await ticket.save();

  return findVisibleTicket(uuid, req);
};

/**
 * List the users a ticket can be ASSIGNED to: active members of the TICKET's own
 * organization, searchable + paginated server-side.
 *
 * Why a dedicated endpoint (not the generic /users list):
 *   - Correctness: assignment is same-tenant only. A super_admin browsing /users sees
 *     every org; that's wrong for an assignee picker. Here we scope strictly to the
 *     ticket's organization_id (derived from the ticket, never from the request).
 *   - Scale: never ship "all users" to the client. Search + limit means this stays
 *     O(page) even with millions of users, backed by the org_id + trigram indexes.
 *
 * Access mirrors assignment itself: the caller must be able to SEE the ticket
 * (visibility-scoped fetch) and be a manager (ticket.assign, enforced at the route).
 */
const listAssignableUsers = async (uuid, req, res) => {
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }

  // Scope to THIS ticket's organization + only active users can be assigned work.
  const scopeWhere = { organization_id: ticket.organization_id, status: 'active' };

  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere,
    attributes: USER_SUMMARY_ATTRIBUTES,
  });
};

/**
 * Change a ticket's status.
 *   - Managers: may change ANY visible ticket's status (Change any ticket status ✅).
 *   - Normal user: may change status ONLY on tickets assigned to them
 *     (Change assigned ticket status ✅, Change any ticket status ❌).
 * Maintains resolved_at / closed_at timestamps.
 */
const updateStatus = async (uuid, status, req, res) => {
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }

  const canChange =
    isOrgManager(req.auth) || ticket.assigned_to_id === req.auth.userId;
  if (!canChange) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }

  ticket.status = status;
  ticket.resolved_at = status === TICKET_STATUSES.RESOLVED ? new Date() : null;
  ticket.closed_at =
    status === TICKET_STATUSES.CLOSED || status === TICKET_STATUSES.CANCELLED
      ? new Date()
      : null;
  await ticket.save();

  return findVisibleTicket(uuid, req);
};

/**
 * Delete a ticket. Gated by the ticket.delete permission at the route; org managers
 * hold it by policy (Delete ticket: super_admin ✅, org_admin per policy, normal ❌).
 * Still visibility-scoped so a manager can only delete within their own org.
 */
const deleteTicket = async (uuid, req, res) => {
  const ticket = await findVisibleTicket(uuid, req);
  if (!ticket) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('ticket_not_found'));
  }
  await ticket.destroy();
  return true;
};

module.exports = {
  createTicket,
  listTickets,
  getTicketByUuid,
  updateTicket,
  setAssignee,
  listAssignableUsers,
  updateStatus,
  deleteTicket,
  buildTicketScope,
  isOrgManager,
};
