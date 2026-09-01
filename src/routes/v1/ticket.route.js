const express = require('express');
const validate = require('../../middlewares/validate');
const { ticketValidation } = require('../../validations');
const ticketController = require('../../controllers/tickets/ticket.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission.
// tenantScope sets req.tenantWhere so the service auto-filters by organization; the
// service then layers the per-role visibility/action policy (submitted/assigned,
// own-vs-any, assigned-only status changes) on top.

router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TICKET_CREATE),
    validate(ticketValidation.createTicket),
    ticketController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TICKET_READ),
    validate(ticketValidation.listTickets),
    ticketController.list
  );

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TICKET_READ),
    validate(ticketValidation.getTicket),
    ticketController.getOne
  )
  .put(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TICKET_UPDATE),
    validate(ticketValidation.updateTicket),
    ticketController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TICKET_DELETE),
    validate(ticketValidation.deleteTicket),
    ticketController.remove
  );

// Assignable users for a ticket — the picker source. Scoped to the TICKET's own
// organization, searchable + paginated. Managers only (ticket.assign).
router.get(
  '/:uuid/assignable-users',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TICKET_ASSIGN),
  validate(ticketValidation.listAssignableUsers),
  ticketController.assignableUsers
);

// Assign / unassign — managers only (ticket.assign).
router.patch(
  '/:uuid/assignee',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TICKET_ASSIGN),
  validate(ticketValidation.assignTicket),
  ticketController.assign
);

// Change status — managers change any; normal users change only tickets assigned to
// them (enforced in the service). Both hold ticket.status_update.
router.patch(
  '/:uuid/status',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TICKET_STATUS_UPDATE),
  validate(ticketValidation.updateStatus),
  ticketController.updateStatus
);

module.exports = router;
