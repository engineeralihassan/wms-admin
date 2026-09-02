/**
 * RBAC single source of truth.
 *
 * This file defines every permission the system understands, the built-in
 * ("system") roles, and which permissions each system role receives when seeded.
 *
 * Design notes:
 *  - Permissions are the atomic unit of authorization. Endpoints check permissions,
 *    never role names, so new roles can be created (with any mix of permissions)
 *    WITHOUT changing endpoint code.
 *  - Roles are just named bundles of permissions. System roles are seeded from here;
 *    organizations may later define custom roles in the DB using the same permissions.
 *  - `scope` distinguishes platform-level roles (super_admin) from org-level roles.
 */

/** Role scope: platform roles are not tied to any organization. */
const ROLE_SCOPES = Object.freeze({
  PLATFORM: 'platform',
  ORGANIZATION: 'organization',
});

/**
 * Canonical role keys. Stored as `roles.key` in the DB.
 * These are the built-in roles; custom org roles can be added at runtime.
 */
const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ORG_ADMIN: 'org_admin',
  VENDOR: 'vendor',
  CONSULTANT_1099: 'consultant_1099',
  CONSULTANT_C2C: 'consultant_c2c',
});

/**
 * Permission catalog. Convention: `<resource>.<action>`.
 * Add new capabilities here; they become assignable to any role immediately.
 */
const PERMISSIONS = Object.freeze({
  // Platform-wide (super admin territory)
  ORG_CREATE: 'organization.create',
  ORG_READ_ALL: 'organization.read_all',
  ORG_UPDATE: 'organization.update',
  ORG_DELETE: 'organization.delete',
  PLATFORM_MANAGE: 'platform.manage',

  // Organization-scoped user management
  USER_CREATE: 'user.create',
  USER_READ: 'user.read',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',

  // Role management within an org
  ROLE_READ: 'role.read',
  ROLE_MANAGE: 'role.manage',

    // Tickets
  TICKET_CREATE: 'ticket.create',
  TICKET_READ: 'ticket.read',
  TICKET_UPDATE: 'ticket.update',
  TICKET_ASSIGN: 'ticket.assign',
  TICKET_STATUS_UPDATE: 'ticket.status_update',
  TICKET_DELETE: 'ticket.delete',

  // Expenses
  EXPENSE_CREATE: 'expense.create',
  EXPENSE_READ: 'expense.read',
  EXPENSE_UPDATE: 'expense.update',
  EXPENSE_DELETE: 'expense.delete',
  // The manager-distinguishing capability: holders can see ALL of their org's
  // expenses and approve/reject submitted ones (analogous to ticket.assign).
  EXPENSE_REVIEW: 'expense.review',

  // Projects
  PROJECT_CREATE: 'project.create',
  PROJECT_READ: 'project.read',
  PROJECT_UPDATE: 'project.update',
  PROJECT_DELETE: 'project.delete',
  // The manager-distinguishing capability: holders see ALL of their org's projects
  // and can add/remove members and set the project lead (analogous to ticket.assign
  // and expense.review). Normal members only see projects they're assigned to.
  PROJECT_MANAGE: 'project.manage',

  // Leave / Time Off
  LEAVE_CREATE: 'leave.create',
  LEAVE_READ: 'leave.read',
  LEAVE_UPDATE: 'leave.update',
  LEAVE_DELETE: 'leave.delete',
  // The manager-distinguishing capability: holders see ALL of their org's leave
  // requests and can approve/reject/cancel them (analogous to ticket.assign and
  // expense.review). Normal members only see their own requests.
  LEAVE_APPROVE: 'leave.approve',
  // Admin capability to manage leave types and allocate/adjust user leave balances.
  LEAVE_ALLOCATE: 'leave.allocate',

  // Example domain resource (warehouse/orders will follow this pattern)
  ORDER_CREATE: 'order.create',
  ORDER_READ: 'order.read',
  ORDER_UPDATE: 'order.update',
  ORDER_DELETE: 'order.delete',
});

/** Flat list of all permission strings, used by the seeder. */
const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/**
 * Which permissions each SYSTEM role gets when seeded.
 * super_admin is handled specially (implicit all-access) — see below.
 */
const ROLE_PERMISSIONS = Object.freeze({
  // super_admin intentionally maps to ALL permissions; kept explicit for clarity,
  // and additionally granted an implicit bypass in the authorization layer.
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,

  [ROLES.ORG_ADMIN]: [
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_ASSIGN,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    PERMISSIONS.TICKET_DELETE,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    PERMISSIONS.EXPENSE_REVIEW,
    PERMISSIONS.PROJECT_CREATE,
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_UPDATE,
    PERMISSIONS.PROJECT_DELETE,
    PERMISSIONS.PROJECT_MANAGE,
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.LEAVE_ALLOCATE,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.ORDER_DELETE,
  ],

  // A vendor manages their own consultants: create/read/update users (scoped by
  // ownership at the service layer to only the consultants they created).
  [ROLES.VENDOR]: [
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    // Vendors submit their own expense claims; approval stays with org admins.
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    // Vendors see only the projects they are assigned to (member visibility).
    PERMISSIONS.PROJECT_READ,
    // Vendors apply for and manage their OWN leave; approval stays with org admins.
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CREATE,
  ],

  // "Normal User" tier for tickets: may create, read (scoped to their own
  // submitted/assigned tickets by the service), update their OWN ticket, and change
  // the status of tickets assigned to them. They intentionally do NOT get
  // ticket.assign or ticket.delete (see the permission matrix).
  [ROLES.CONSULTANT_1099]: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    // Consultants submit and manage their OWN expenses (no review capability).
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    // Consultants see only the projects they are assigned to (member visibility).
    PERMISSIONS.PROJECT_READ,
    // Consultants apply for and manage their OWN leave (no approve/allocate).
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
  ],

  [ROLES.CONSULTANT_C2C]: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    // Consultants submit and manage their OWN expenses (no review capability).
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    // Consultants see only the projects they are assigned to (member visibility).
    PERMISSIONS.PROJECT_READ,
    // Consultants apply for and manage their OWN leave (no approve/allocate).
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
  ],
});

/** Metadata for seeding roles (display name + scope). */
const ROLE_DEFINITIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: { name: 'Super Admin', scope: ROLE_SCOPES.PLATFORM },
  [ROLES.ORG_ADMIN]: { name: 'Organization Admin', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.VENDOR]: { name: 'Vendor', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.CONSULTANT_1099]: { name: 'Consultant (1099)', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.CONSULTANT_C2C]: { name: 'Consultant (C2C)', scope: ROLE_SCOPES.ORGANIZATION },
});

/** Consultant roles (the "owned" roles a vendor manages). */
const CONSULTANT_ROLES = Object.freeze([ROLES.CONSULTANT_1099, ROLES.CONSULTANT_C2C]);

/**
 * Which roles each ROLE is allowed to assign when creating a user.
 * This is the guardrail that stops privilege escalation:
 *  - org_admin can create vendors and consultants (not super_admin, not other org_admins by default).
 *  - vendor can ONLY create consultants.
 *  - super_admin is unrestricted (handled in code, bypasses this map).
 */
const ASSIGNABLE_ROLES_BY_ROLE = Object.freeze({
  [ROLES.ORG_ADMIN]: [ROLES.VENDOR, ROLES.CONSULTANT_1099, ROLES.CONSULTANT_C2C],
  [ROLES.VENDOR]: [ROLES.CONSULTANT_1099, ROLES.CONSULTANT_C2C],
});

/**
 * Legacy alias kept for the org-level assignable set (used by validation).
 * Union of everything an org-scoped actor could assign.
 */
const ORG_ASSIGNABLE_ROLES = Object.freeze([
  ROLES.ORG_ADMIN,
  ROLES.VENDOR,
  ROLES.CONSULTANT_1099,
  ROLES.CONSULTANT_C2C,
]);

module.exports = {
  ROLE_SCOPES,
  ROLES,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_DEFINITIONS,
  ORG_ASSIGNABLE_ROLES,
  CONSULTANT_ROLES,
  ASSIGNABLE_ROLES_BY_ROLE,
};
