const express = require('express');
const validate = require('../../middlewares/validate');
const { opportunityValidation } = require('../../validations');
const opportunityController = require('../../controllers/opportunity/opportunity.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

/**
 * Opportunity discovery routes (authenticated). Every route:
 *   authVerify -> tenantScope -> requirePermission -> validate -> controller
 *
 * The service layers the owner overlay on top of tenantScope (buildOpportunityScope): a
 * rep sees/acts on only opportunities they discovered; a manager / org admin (holding
 * opportunity.delete) sees the whole org. super_admin spans orgs.
 */

// Run a live external search and persist idempotent, org-scoped opportunities.
router.post(
  '/discover',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_DISCOVER),
  validate(opportunityValidation.discover),
  opportunityController.discover
);

router.get(
  '/',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_READ),
  validate(opportunityValidation.listOpportunities),
  opportunityController.list
);

router.get(
  '/:uuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_READ),
  validate(opportunityValidation.getOpportunity),
  opportunityController.getOne
);

// Save / reject / reset an opportunity (any reader who can see it).
router.patch(
  '/:uuid/status',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_READ),
  validate(opportunityValidation.setStatus),
  opportunityController.setStatus
);

// Convert an opportunity into a Sales Lead.
router.post(
  '/:uuid/convert',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_CONVERT),
  validate(opportunityValidation.convertToLead),
  opportunityController.convert
);

router.delete(
  '/:uuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.OPPORTUNITY_DELETE),
  validate(opportunityValidation.deleteOpportunity),
  opportunityController.remove
);

module.exports = router;
