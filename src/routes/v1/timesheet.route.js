const express = require('express');
const validate = require('../../middlewares/validate');
const { timesheetValidation } = require('../../validations');
const timesheetController = require('../../controllers/timesheets/timesheet.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission -> validate.
// tenantScope sets req.tenantWhere so the service auto-filters by organization; the
// service then layers the per-role visibility/action policy (owner-only edits,
// approver-only review/correct, submitted-only decisions, lock-date enforcement) on top.

// The project picker: projects the caller may log time against. Declared BEFORE the
// "/:uuid" route so the literal path isn't captured as a uuid param.
router.get(
  '/projects',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TIMESHEET_READ),
  validate(timesheetValidation.listProjects),
  timesheetController.listProjects
);

router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TIMESHEET_CREATE),
    validate(timesheetValidation.createTimesheet),
    timesheetController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TIMESHEET_READ),
    validate(timesheetValidation.listTimesheets),
    timesheetController.list
  );

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TIMESHEET_READ),
    validate(timesheetValidation.getTimesheet),
    timesheetController.getOne
  )
  // Approver correction (edit entries + accept, backfill locked sheets). Requires the
  // manager capability; ownership/state rules are enforced in the service.
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TIMESHEET_APPROVE),
    validate(timesheetValidation.correctTimesheet),
    timesheetController.correct
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.TIMESHEET_DELETE),
    validate(timesheetValidation.deleteTimesheet),
    timesheetController.remove
  );

// Bulk-save the week's daily hours/notes ("Save as draft") — owner action, holds
// timesheet.update (owner + editable-status + before-lock enforced in the service).
router.patch(
  '/:uuid/entries',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TIMESHEET_UPDATE),
  validate(timesheetValidation.saveEntries),
  timesheetController.saveEntries
);

// Submit the week for approval — owner action.
router.post(
  '/:uuid/submit',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TIMESHEET_UPDATE),
  validate(timesheetValidation.submitTimesheet),
  timesheetController.submit
);

// Withdraw a submitted week back to unsubmitted — owner action.
router.post(
  '/:uuid/withdraw',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TIMESHEET_UPDATE),
  validate(timesheetValidation.withdrawTimesheet),
  timesheetController.withdraw
);

// Approve / reject a submitted week — approvers only (timesheet.approve).
router.post(
  '/:uuid/review',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TIMESHEET_APPROVE),
  validate(timesheetValidation.reviewTimesheet),
  timesheetController.review
);

module.exports = router;
