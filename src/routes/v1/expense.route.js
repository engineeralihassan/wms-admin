const express = require('express');
const validate = require('../../middlewares/validate');
const { expenseValidation } = require('../../validations');
const expenseController = require('../../controllers/expenses/expense.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission.
// tenantScope sets req.tenantWhere so the service auto-filters by organization; the
// service then layers the per-role visibility/action policy (owner-only edits,
// reviewer-only approve/reject, submitted-only decisions) on top.

router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.EXPENSE_CREATE),
    validate(expenseValidation.createExpense),
    expenseController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.EXPENSE_READ),
    validate(expenseValidation.listExpenses),
    expenseController.list
  );

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.EXPENSE_READ),
    validate(expenseValidation.getExpense),
    expenseController.getOne
  )
  .put(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.EXPENSE_UPDATE),
    validate(expenseValidation.updateExpense),
    expenseController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.EXPENSE_DELETE),
    validate(expenseValidation.deleteExpense),
    expenseController.remove
  );

// Submit a draft/rejected expense for approval — owner only (enforced in the service).
// Holds expense.update since it's an owner action on their own claim.
router.patch(
  '/:uuid/submit',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.EXPENSE_UPDATE),
  validate(expenseValidation.submitExpense),
  expenseController.submit
);

// Approve / reject a submitted expense — reviewers only (expense.review).
router.patch(
  '/:uuid/review',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.EXPENSE_REVIEW),
  validate(expenseValidation.reviewExpense),
  expenseController.review
);

module.exports = router;
