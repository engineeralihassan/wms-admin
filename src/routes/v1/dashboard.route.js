const express = require('express');
const dashboardController = require('../../controllers/dashboard/dashboard.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Dashboard is intentionally split into one endpoint PER WIDGET rather than a single
 * fat aggregate. The frontend fires them in parallel and renders a per-widget loader,
 * so a slow query for one module never blocks the rest of the dashboard.
 *
 * Every route runs the standard chain: authenticate -> enforce tenant scope -> check
 * permission. DASHBOARD_READ gates access to the dashboard as a whole; the data inside
 * each widget is additionally scoped by the service to what the caller may already see
 * (own-vs-org visibility per module). The organizations chart is platform-wide, so it
 * additionally requires organization.read_all (super admin only).
 */

// Profile card — any authenticated, tenant-scoped user can see their OWN profile.
// It exposes nothing beyond req.auth's own user, so no module permission is required.
router.get('/me', authVerify, tenantScope, dashboardController.me);

// ── Charts (one bar-chart per module) ─────────────────────────────────────────
//
// Each chart only aggregates data the caller can ALREADY read, so it requires that
// module's existing read permission — NOT a separate dashboard permission. This keeps
// visibility consistent with the module's list page and avoids depending on a new
// permission that older roles might not have been granted yet.
router.get(
  '/charts/leaves',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAVE_READ),
  dashboardController.leaveChart
);

router.get(
  '/charts/tickets',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TICKET_READ),
  dashboardController.ticketChart
);

router.get(
  '/charts/expenses',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.EXPENSE_READ),
  dashboardController.expenseChart
);

router.get(
  '/charts/projects',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_READ),
  dashboardController.projectChart
);

// The users chart aggregates org users, so it requires user.read (org admins have it;
// consultants/vendors do not and simply won't see this widget — the FE hides it too).
router.get(
  '/charts/users',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.USER_READ),
  dashboardController.userChart
);

// Organizations chart — platform-wide, super admin only.
router.get(
  '/charts/organizations',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ORG_READ_ALL),
  dashboardController.organizationChart
);

// ── Actionable summary cards + recent side-panel lists ─────────────────────────
//
// The summary card values and recent lists are each scoped by the service to what the
// caller can see. They aggregate across modules, so any single module read permission
// is enough to view them; the service returns only the buckets the caller is allowed.
router.get(
  '/summary',
  authVerify,
  tenantScope,
  requirePermission(
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.USER_READ
  ),
  dashboardController.summary
);

router.get(
  '/recent-projects',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_READ),
  dashboardController.recentProjects
);

router.get(
  '/recent-tickets',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.TICKET_READ),
  dashboardController.recentUrgentTickets
);

module.exports = router;
