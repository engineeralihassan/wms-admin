const express = require('express');
const validate = require('../../middlewares/validate');
const { leaveValidation } = require('../../validations');
const leaveController = require('../../controllers/leaves/leave.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission.
// tenantScope sets req.tenantWhere so the service auto-filters by organization; the
// service then layers the per-role visibility/action policy (own-vs-any, approver-only
// decisions, allocator-only balance/type management) on top.

// ── Collection ──────────────────────────────────────────────────────────────
router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_CREATE),
    validate(leaveValidation.createLeave),
    leaveController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_READ),
    validate(leaveValidation.listLeaves),
    leaveController.list
  );

// ── Fixed paths (MUST precede '/:uuid' so they aren't captured as a uuid) ─────

// The caller's own balances — "do I have paid leave available?".
router.get(
  '/balances/me',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_READ),
  validate(leaveValidation.myBalances),
  leaveController.myBalances
);

// Timesheet-facing calendar of leave days in a range.
router.get(
  '/calendar',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_READ),
  validate(leaveValidation.leaveCalendar),
  leaveController.calendar
);

// Leave types (list is readable by anyone who can read leave; create requires allocate).
router
  .route('/types')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_READ),
    validate(leaveValidation.listLeaveTypes),
    leaveController.listTypes
  )
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_ALLOCATE),
    validate(leaveValidation.createLeaveType),
    leaveController.createType
  );

router.put(
  '/types/:uuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_ALLOCATE),
  validate(leaveValidation.updateLeaveType),
  leaveController.updateType
);

// Balance administration (allocate / adjust user balances).
router
  .route('/balances')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_ALLOCATE),
    validate(leaveValidation.listBalances),
    leaveController.listBalances
  )
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_ALLOCATE),
    validate(leaveValidation.allocateBalance),
    leaveController.allocate
  );

// ── Single resource by uuid ──────────────────────────────────────────────────
router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_READ),
    validate(leaveValidation.getLeave),
    leaveController.getOne
  )
  .put(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_UPDATE),
    validate(leaveValidation.updateLeave),
    leaveController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAVE_DELETE),
    validate(leaveValidation.deleteLeave),
    leaveController.remove
  );

// Submit a draft/rejected request (owner). Held paid days checked in the service.
router.patch(
  '/:uuid/submit',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_CREATE),
  validate(leaveValidation.submitLeave),
  leaveController.submit
);

// Withdraw a pending request (applicant).
router.patch(
  '/:uuid/withdraw',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_UPDATE),
  validate(leaveValidation.withdrawLeave),
  leaveController.withdraw
);

// Approve / reject a submitted request (approver only).
router.patch(
  '/:uuid/decision',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_APPROVE),
  validate(leaveValidation.decideLeave),
  leaveController.decide
);

// Cancel a submitted/approved request (approver only).
router.patch(
  '/:uuid/cancel',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_APPROVE),
  validate(leaveValidation.cancelLeave),
  leaveController.cancel
);

module.exports = router;
