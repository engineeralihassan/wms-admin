const express = require('express');
const validate = require('../../middlewares/validate');
const { projectValidation } = require('../../validations');
const projectController = require('../../controllers/projects/project.controller');
const { authVerify, requirePermission, tenantScope } = require('../../middlewares/auth');
const { PERMISSIONS } = require('../../config/rbac');

const router = express.Router();

// Every route: authenticate -> enforce tenant scope -> check permission.
// tenantScope sets req.tenantWhere so the service auto-filters by organization; the
// service then layers the per-role visibility policy (managers see all org projects,
// normal users see only projects they're a member of) on top.

router
  .route('/')
  .post(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.PROJECT_CREATE),
    validate(projectValidation.createProject),
    projectController.create
  )
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.PROJECT_READ),
    validate(projectValidation.listProjects),
    projectController.list
  );

// Convenience: projects the caller is a member of ("My Projects").
router.get(
  '/mine',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_READ),
  validate(projectValidation.listMine),
  projectController.listMine
);

router
  .route('/:uuid')
  .get(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.PROJECT_READ),
    validate(projectValidation.getProject),
    projectController.getOne
  )
  .put(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.PROJECT_UPDATE),
    validate(projectValidation.updateProject),
    projectController.update
  )
  .delete(
    authVerify,
    tenantScope,
    requirePermission(PERMISSIONS.PROJECT_DELETE),
    validate(projectValidation.deleteProject),
    projectController.remove
  );

// Members list — anyone who can read the project.
router.get(
  '/:uuid/members',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_READ),
  validate(projectValidation.listMembers),
  projectController.listMembers
);

// Assignable users (picker source) — managers only (project.manage).
router.get(
  '/:uuid/assignable-users',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_MANAGE),
  validate(projectValidation.listAssignableUsers),
  projectController.assignableUsers
);

// Add members — managers only (project.manage).
router.post(
  '/:uuid/members',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_MANAGE),
  validate(projectValidation.addMembers),
  projectController.addMembers
);

// Change a member's project role — managers only.
router.patch(
  '/:uuid/members/:userUuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_MANAGE),
  validate(projectValidation.updateMember),
  projectController.updateMember
);

// Remove a member — managers only.
router.delete(
  '/:uuid/members/:userUuid',
  authVerify,
  tenantScope,
  requirePermission(PERMISSIONS.PROJECT_MANAGE),
  validate(projectValidation.removeMember),
  projectController.removeMember
);

module.exports = router;
