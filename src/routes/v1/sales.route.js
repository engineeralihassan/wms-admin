const express = require('express');
const validate = require('../../middlewares/validate');
const {
  salesLeadValidation,
  salesAccountValidation,
  salesContactValidation,
  salesDealValidation,
  salesActivityValidation,
  salesTeamValidation,
  salesPipelineValidation,
  salesConfigValidation,
} = require('../../validations');
const leadController = require('../../controllers/sales/lead.controller');
const accountController = require('../../controllers/sales/account.controller');
const contactController = require('../../controllers/sales/contact.controller');
const dealController = require('../../controllers/sales/deal.controller');
const activityController = require('../../controllers/sales/activity.controller');
const teamController = require('../../controllers/sales/team.controller');
const pipelineController = require('../../controllers/sales/pipeline.controller');
const salesConfigController = require('../../controllers/sales/sales-config.controller');
const salesDashboardController = require('../../controllers/sales/sales-dashboard.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Sales & CRM routes (authenticated). Every route:
 *   authVerify -> tenantScope -> requirePermission -> validate -> controller
 *
 * The service layers the sales owner/visibility policy on top of tenantScope (via
 * buildSalesScope): a sales_rep sees/acts on only their OWN records; a sales_manager /
 * org_admin (holding *.manage_all) sees the whole org. super_admin spans orgs.
 *
 * This file grows as each Phase-1 resource lands (accounts, contacts, deals, activities,
 * teams, pipelines, dashboard). Leads is the first slice and sets the pattern.
 */

// ── Leads ───────────────────────────────────────────────────────────────────
router
  .route('/leads')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAD_CREATE),
    validate(salesLeadValidation.createLead),
    leadController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAD_READ),
    validate(salesLeadValidation.listLeads),
    leadController.list
  );

router
  .route('/leads/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAD_READ),
    validate(salesLeadValidation.getLead),
    leadController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAD_UPDATE),
    validate(salesLeadValidation.updateLead),
    leadController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.LEAD_DELETE),
    validate(salesLeadValidation.deleteLead),
    leadController.remove
  );

// Reassign a lead's owner (manager capability).
router.post(
  '/leads/:uuid/assign',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAD_ASSIGN),
  validate(salesLeadValidation.assignLead),
  leadController.assign
);

// Convert a lead into an account + contact (+ optional deal).
router.post(
  '/leads/:uuid/convert',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.LEAD_CONVERT),
  validate(salesLeadValidation.convertLead),
  leadController.convert
);

// ── Accounts (companies) ──────────────────────────────────────────────────────
router
  .route('/accounts')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACCOUNT_CREATE),
    validate(salesAccountValidation.createAccount),
    accountController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACCOUNT_READ),
    validate(salesAccountValidation.listAccounts),
    accountController.list
  );

router
  .route('/accounts/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACCOUNT_READ),
    validate(salesAccountValidation.getAccount),
    accountController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACCOUNT_UPDATE),
    validate(salesAccountValidation.updateAccount),
    accountController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACCOUNT_DELETE),
    validate(salesAccountValidation.deleteAccount),
    accountController.remove
  );

// ── Contacts (people) ───────────────────────────────────────────────────────
router
  .route('/contacts')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CONTACT_CREATE),
    validate(salesContactValidation.createContact),
    contactController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CONTACT_READ),
    validate(salesContactValidation.listContacts),
    contactController.list
  );

router
  .route('/contacts/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CONTACT_READ),
    validate(salesContactValidation.getContact),
    contactController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CONTACT_UPDATE),
    validate(salesContactValidation.updateContact),
    contactController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.CONTACT_DELETE),
    validate(salesContactValidation.deleteContact),
    contactController.remove
  );

// ── Deals (opportunities) ─────────────────────────────────────────────────────
// Board must be registered before /deals/:uuid so "board" isn't captured as a uuid.
router.get(
  '/deals/board',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.DEAL_READ),
  validate(salesDealValidation.board),
  dealController.board
);

router
  .route('/deals')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_CREATE),
    validate(salesDealValidation.createDeal),
    dealController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_READ),
    validate(salesDealValidation.listDeals),
    dealController.list
  );

router
  .route('/deals/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_READ),
    validate(salesDealValidation.getDeal),
    dealController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_UPDATE),
    validate(salesDealValidation.updateDeal),
    dealController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_DELETE),
    validate(salesDealValidation.deleteDeal),
    dealController.remove
  );

// Move a deal to another pipeline stage (the Kanban drag action).
router.post(
  '/deals/:uuid/stage',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.DEAL_UPDATE),
  validate(salesDealValidation.changeStage),
  dealController.changeStage
);

// Reassign a deal's owner (manager capability).
router.post(
  '/deals/:uuid/reassign',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.DEAL_REASSIGN),
  validate(salesDealValidation.reassignDeal),
  dealController.reassign
);

// ── Activities (polymorphic timeline + tasks) ─────────────────────────────────
// My open/overdue tasks. Registered before /activities/:uuid so "my-tasks" isn't a uuid.
router.get(
  '/activities/my-tasks',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ACTIVITY_READ),
  validate(salesActivityValidation.myTasks),
  activityController.myTasks
);

router.post(
  '/activities',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ACTIVITY_CREATE),
  validate(salesActivityValidation.createActivity),
  activityController.create
);

router
  .route('/activities/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACTIVITY_READ),
    validate(salesActivityValidation.getActivity),
    activityController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACTIVITY_UPDATE),
    validate(salesActivityValidation.updateActivity),
    activityController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.ACTIVITY_DELETE),
    validate(salesActivityValidation.deleteActivity),
    activityController.remove
  );

router.post(
  '/activities/:uuid/complete',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ACTIVITY_UPDATE),
  validate(salesActivityValidation.completeActivity),
  activityController.complete
);

router.post(
  '/activities/:uuid/cancel',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ACTIVITY_UPDATE),
  validate(salesActivityValidation.cancelActivity),
  activityController.cancel
);

// A record's activity timeline (lead|account|contact|deal). related_type is validated.
router.get(
  '/:relatedType/:relatedUuid/activities',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.ACTIVITY_READ),
  validate(salesActivityValidation.listForRecord),
  activityController.listForRecord
);

// ── Sales teams ───────────────────────────────────────────────────────────────
// Tenant-scoped active-user picker for building teams (search + paginate).
router.get(
  '/members',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.SALES_TEAM_READ),
  validate(salesTeamValidation.searchMembers),
  teamController.searchMembers
);

router
  .route('/teams')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_TEAM_MANAGE),
    validate(salesTeamValidation.createTeam),
    teamController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_TEAM_READ),
    teamController.list
  );

router
  .route('/teams/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_TEAM_READ),
    validate(salesTeamValidation.getTeam),
    teamController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_TEAM_MANAGE),
    validate(salesTeamValidation.updateTeam),
    teamController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_TEAM_MANAGE),
    validate(salesTeamValidation.deleteTeam),
    teamController.remove
  );

router.post(
  '/teams/:uuid/members',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.SALES_TEAM_MANAGE),
  validate(salesTeamValidation.addMember),
  teamController.addMember
);

router.delete(
  '/teams/:uuid/members/:userUuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.SALES_TEAM_MANAGE),
  validate(salesTeamValidation.removeMember),
  teamController.removeMember
);

// ── Pipelines (read for any sales reader; write gated by sales.configure) ──────
router
  .route('/pipelines')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_CONFIGURE),
    validate(salesPipelineValidation.createPipeline),
    pipelineController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_READ),
    validate(salesPipelineValidation.listPipelines),
    pipelineController.list
  );

router
  .route('/pipelines/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_READ),
    validate(salesPipelineValidation.getPipeline),
    pipelineController.getOne
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_CONFIGURE),
    validate(salesPipelineValidation.updatePipeline),
    pipelineController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_CONFIGURE),
    validate(salesPipelineValidation.deletePipeline),
    pipelineController.remove
  );

// ── Sales configuration ───────────────────────────────────────────────────────
router
  .route('/config')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.DEAL_READ),
    validate(salesConfigValidation.getConfig),
    salesConfigController.getConfig
  )
  .patch(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.SALES_CONFIGURE),
    validate(salesConfigValidation.updateConfig),
    salesConfigController.updateConfig
  );

// ── Dashboard (role-aware KPIs) ───────────────────────────────────────────────
router.get(
  '/dashboard',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.DEAL_READ),
  salesDashboardController.getDashboard
);

module.exports = router;
