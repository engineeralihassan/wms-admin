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
  CONSULTANT_W2: 'consultant_w2',
  CONSULTANT_1099: 'consultant_1099',
  CONSULTANT_C2C: 'consultant_c2c',
  // Recruiter: owns the ATS. Creates job openings and manages the candidates who
  // apply to their own jobs. Org-scoped like the other org roles.
  RECRUITER: 'recruiter',
  // Sales rep: a member of the sales team. Owns their own leads/accounts/contacts/deals
  // and activities; no cross-rep visibility. Org-scoped.
  SALES_REP: 'sales_rep',
  // Sales manager: runs the org's sales. Sees ALL sales data in the org (the *.manage_all
  // overlay), manages pipelines/teams/targets/commissions, and configures the module.
  SALES_MANAGER: 'sales_manager',
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

  // Timesheets — weekly time logging against a project.
  TIMESHEET_CREATE: 'timesheet.create',
  TIMESHEET_READ: 'timesheet.read',
  TIMESHEET_UPDATE: 'timesheet.update',
  TIMESHEET_DELETE: 'timesheet.delete',
  // The manager-distinguishing capability: holders see ALL of their org's timesheets
  // and can approve/reject, correct, and backfill locked sheets (analogous to
  // leave.approve and expense.review). Normal members only see their own timesheets.
  TIMESHEET_APPROVE: 'timesheet.approve',

  FILE_UPLOAD: 'file.upload',
  FILE_READ: 'file.read',
  FILE_DELETE: 'file.delete',

  // ATS — Job openings (recruiter-facing).
  JOB_CREATE: 'job.create',
  JOB_READ: 'job.read',
  JOB_UPDATE: 'job.update',
  JOB_DELETE: 'job.delete',
  // The manager-distinguishing capability: holders see ALL of their org's jobs and
  // applications (org admin). Without it, a recruiter sees only their OWN jobs and
  // the applications to those jobs — enforced at the service layer.
  JOB_MANAGE_ALL: 'job.manage_all',

  // ATS — Candidate applications (recruiter-facing review + status/stage actions).
  APPLICATION_READ: 'application.read',
  APPLICATION_UPDATE: 'application.update',
  APPLICATION_DELETE: 'application.delete',

  // ATS — Interview scheduling (book/reschedule/cancel interviews for an application).
  // Visibility is inherited from the parent application/job scope at the service layer,
  // so a recruiter can only schedule on candidates they already see.
  INTERVIEW_CREATE: 'interview.create',
  INTERVIEW_READ: 'interview.read',
  INTERVIEW_UPDATE: 'interview.update',
  INTERVIEW_DELETE: 'interview.delete',

  // Chat / direct messaging. Everyone in an org may read and send; isolation is
  // enforced at the org boundary in the service/socket layer (not by permission).
  CHAT_READ: 'chat.read',
  CHAT_SEND: 'chat.send',

  // Example domain resource (warehouse/orders will follow this pattern)
  ORDER_CREATE: 'order.create',
  ORDER_READ: 'order.read',
  ORDER_UPDATE: 'order.update',
  ORDER_DELETE: 'order.delete',

  // ── Sales & CRM ──────────────────────────────────────────────────────────
  // Leads. A sales_rep gets create/read/update/delete + convert scoped to their OWN
  // leads (service layer). lead.manage_all is the manager overlay (see ALL org leads,
  // analogous to job.manage_all); lead.assign lets a manager (re)assign a lead's owner.
  LEAD_CREATE: 'lead.create',
  LEAD_READ: 'lead.read',
  LEAD_UPDATE: 'lead.update',
  LEAD_DELETE: 'lead.delete',
  LEAD_CONVERT: 'lead.convert',
  LEAD_MANAGE_ALL: 'lead.manage_all',
  LEAD_ASSIGN: 'lead.assign',

  // Accounts (companies). account.manage_all = manager overlay (whole-org visibility).
  ACCOUNT_CREATE: 'account.create',
  ACCOUNT_READ: 'account.read',
  ACCOUNT_UPDATE: 'account.update',
  ACCOUNT_DELETE: 'account.delete',
  ACCOUNT_MANAGE_ALL: 'account.manage_all',

  // Contacts (people). Visibility inherits from their account (or owner for B2C).
  CONTACT_CREATE: 'contact.create',
  CONTACT_READ: 'contact.read',
  CONTACT_UPDATE: 'contact.update',
  CONTACT_DELETE: 'contact.delete',

  // Deals (opportunities). deal.manage_all = manager overlay; deal.reassign = change owner.
  DEAL_CREATE: 'deal.create',
  DEAL_READ: 'deal.read',
  DEAL_UPDATE: 'deal.update',
  DEAL_DELETE: 'deal.delete',
  DEAL_MANAGE_ALL: 'deal.manage_all',
  DEAL_REASSIGN: 'deal.reassign',

  // Sales activities (calls/meetings/emails/notes/tasks/follow-ups).
  ACTIVITY_CREATE: 'activity.create',
  ACTIVITY_READ: 'activity.read',
  ACTIVITY_UPDATE: 'activity.update',
  ACTIVITY_DELETE: 'activity.delete',

  // Sales configuration surface: pipelines, lead sources, custom fields, feature flags.
  SALES_CONFIGURE: 'sales.configure',

  // Sales teams.
  SALES_TEAM_READ: 'sales_team.read',
  SALES_TEAM_MANAGE: 'sales_team.manage',

  // ── Sales Phase 2 (declared now, granted to managers/admins later) ─────────
  PRODUCT_CREATE: 'product.create',
  PRODUCT_READ: 'product.read',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  QUOTE_CREATE: 'quote.create',
  QUOTE_READ: 'quote.read',
  QUOTE_UPDATE: 'quote.update',
  QUOTE_DELETE: 'quote.delete',
  TARGET_READ: 'target.read',
  TARGET_MANAGE: 'target.manage',
  COMMISSION_READ: 'commission.read',
  COMMISSION_MANAGE: 'commission.manage',
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
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    PERMISSIONS.TIMESHEET_APPROVE,
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.ORDER_DELETE,
    // ATS: org admins oversee the whole ATS — every job and application in the org.
    PERMISSIONS.JOB_CREATE,
    PERMISSIONS.JOB_READ,
    PERMISSIONS.JOB_UPDATE,
    PERMISSIONS.JOB_DELETE,
    PERMISSIONS.JOB_MANAGE_ALL,
    PERMISSIONS.APPLICATION_READ,
    PERMISSIONS.APPLICATION_UPDATE,
    PERMISSIONS.APPLICATION_DELETE,
    PERMISSIONS.INTERVIEW_CREATE,
    PERMISSIONS.INTERVIEW_READ,
    PERMISSIONS.INTERVIEW_UPDATE,
    PERMISSIONS.INTERVIEW_DELETE,
    // Chat: org admins can message anyone in their org.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
    // Sales: org admins have top-level oversight of the whole sales module — every
    // lead/account/contact/deal/activity in the org, plus configuration and teams.
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_READ,
    PERMISSIONS.LEAD_UPDATE,
    PERMISSIONS.LEAD_DELETE,
    PERMISSIONS.LEAD_CONVERT,
    PERMISSIONS.LEAD_MANAGE_ALL,
    PERMISSIONS.LEAD_ASSIGN,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.ACCOUNT_DELETE,
    PERMISSIONS.ACCOUNT_MANAGE_ALL,
    PERMISSIONS.CONTACT_CREATE,
    PERMISSIONS.CONTACT_READ,
    PERMISSIONS.CONTACT_UPDATE,
    PERMISSIONS.CONTACT_DELETE,
    PERMISSIONS.DEAL_CREATE,
    PERMISSIONS.DEAL_READ,
    PERMISSIONS.DEAL_UPDATE,
    PERMISSIONS.DEAL_DELETE,
    PERMISSIONS.DEAL_MANAGE_ALL,
    PERMISSIONS.DEAL_REASSIGN,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ACTIVITY_DELETE,
    PERMISSIONS.SALES_CONFIGURE,
    PERMISSIONS.SALES_TEAM_READ,
    PERMISSIONS.SALES_TEAM_MANAGE,
    // Sales Phase 2 (available to org admins from the start).
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.QUOTE_CREATE,
    PERMISSIONS.QUOTE_READ,
    PERMISSIONS.QUOTE_UPDATE,
    PERMISSIONS.QUOTE_DELETE,
    PERMISSIONS.TARGET_READ,
    PERMISSIONS.TARGET_MANAGE,
    PERMISSIONS.COMMISSION_READ,
    PERMISSIONS.COMMISSION_MANAGE,
  ],

  // ── Sales roles ────────────────────────────────────────────────────────────
  // Sales rep: owns their OWN leads/accounts/contacts/deals/activities (the service
  // narrows reads/writes to owner_id = self — no *.manage_all). They can convert their
  // own leads and log activities, and read teams they belong to. Like a recruiter, a
  // sales rep is ALSO a regular employee: own tickets/expenses/leave/timesheets + own
  // attachments, all scoped to "own only". They get NO user/role/org management perms.
  [ROLES.SALES_REP]: [
    // Sales core (own-scoped at the service layer)
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_READ,
    PERMISSIONS.LEAD_UPDATE,
    PERMISSIONS.LEAD_DELETE,
    PERMISSIONS.LEAD_CONVERT,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.CONTACT_CREATE,
    PERMISSIONS.CONTACT_READ,
    PERMISSIONS.CONTACT_UPDATE,
    PERMISSIONS.DEAL_CREATE,
    PERMISSIONS.DEAL_READ,
    PERMISSIONS.DEAL_UPDATE,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ACTIVITY_DELETE,
    PERMISSIONS.SALES_TEAM_READ,
    // Employee self-service — tickets (own), like a consultant/recruiter.
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    // Employee self-service — expenses (own).
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    // Employee self-service — leave (own).
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    // Employee self-service — timesheets (own).
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    // Own attachments.
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
  ],

  // Sales manager: everything a rep has, PLUS the whole-org visibility overlays
  // (*.manage_all), (re)assignment, delete, team/target/commission management, and the
  // configuration surface (pipelines, sources, custom fields, feature flags). Sees ALL
  // of the org's sales data (product-owner decision §0.6). Still an employee (own
  // self-service). No user/role/org management perms (that stays with org_admin).
  [ROLES.SALES_MANAGER]: [
    // Sales core — full org visibility + management
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_READ,
    PERMISSIONS.LEAD_UPDATE,
    PERMISSIONS.LEAD_DELETE,
    PERMISSIONS.LEAD_CONVERT,
    PERMISSIONS.LEAD_MANAGE_ALL,
    PERMISSIONS.LEAD_ASSIGN,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_READ,
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.ACCOUNT_DELETE,
    PERMISSIONS.ACCOUNT_MANAGE_ALL,
    PERMISSIONS.CONTACT_CREATE,
    PERMISSIONS.CONTACT_READ,
    PERMISSIONS.CONTACT_UPDATE,
    PERMISSIONS.CONTACT_DELETE,
    PERMISSIONS.DEAL_CREATE,
    PERMISSIONS.DEAL_READ,
    PERMISSIONS.DEAL_UPDATE,
    PERMISSIONS.DEAL_DELETE,
    PERMISSIONS.DEAL_MANAGE_ALL,
    PERMISSIONS.DEAL_REASSIGN,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ACTIVITY_DELETE,
    PERMISSIONS.SALES_CONFIGURE,
    PERMISSIONS.SALES_TEAM_READ,
    PERMISSIONS.SALES_TEAM_MANAGE,
    // Sales Phase 2
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.QUOTE_CREATE,
    PERMISSIONS.QUOTE_READ,
    PERMISSIONS.QUOTE_UPDATE,
    PERMISSIONS.QUOTE_DELETE,
    PERMISSIONS.TARGET_READ,
    PERMISSIONS.TARGET_MANAGE,
    PERMISSIONS.COMMISSION_READ,
    PERMISSIONS.COMMISSION_MANAGE,
    // Employee self-service (still an employee).
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
  ],

  // Recruiter: owns the ATS at the org level but scoped to their OWN jobs. Can create
  // and manage job openings, and review/act on the candidates who apply to those jobs.
  // They intentionally do NOT get job.manage_all (that's the org-admin cross-recruiter
  // view) — the service scopes their reads/writes to jobs they created.
  //
  // A recruiter is ALSO a regular employee: like a consultant, they can raise and manage
  // their OWN tickets, expenses and leave, and upload their own attachments. Everything
  // there is scoped to "own only" at the service layer (no ticket.assign / expense.review
  // / leave.approve). They intentionally get NO user/role/organization/project management
  // permissions, so they never see Users / Vendors / Consultants / Organizations.
  [ROLES.RECRUITER]: [
    // ATS
    PERMISSIONS.JOB_CREATE,
    PERMISSIONS.JOB_READ,
    PERMISSIONS.JOB_UPDATE,
    PERMISSIONS.JOB_DELETE,
    PERMISSIONS.APPLICATION_READ,
    PERMISSIONS.APPLICATION_UPDATE,
    PERMISSIONS.APPLICATION_DELETE,
    // ATS: schedule/manage interviews for candidates on their own jobs.
    PERMISSIONS.INTERVIEW_CREATE,
    PERMISSIONS.INTERVIEW_READ,
    PERMISSIONS.INTERVIEW_UPDATE,
    PERMISSIONS.INTERVIEW_DELETE,
    // Employee self-service — tickets (own), like a consultant.
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    // Employee self-service — expenses (own), no review capability.
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    // Employee self-service — leave (own), no approve/allocate.
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    // Employee self-service — timesheets (own), no approve.
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    // Own attachments: upload/read/delete (receipts, docs, candidate CVs).
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
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
    // Vendors log their OWN timesheets against assigned projects; approval stays with
    // org admins / project managers.
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CREATE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
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
    // Consultants log their OWN timesheets against assigned projects (no approve).
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    // Consultants upload/read/delete their own attachments (receipts, docs).
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
  ],

  // W2 consultants are direct employees; permission-wise identical to other
  // consultants (own tickets/expenses/leave + member project visibility). The W2 vs
  // 1099 vs C2C distinction is a tax/engagement classification, not a permission one.
  [ROLES.CONSULTANT_W2]: [
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_READ,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_STATUS_UPDATE,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_READ,
    PERMISSIONS.EXPENSE_UPDATE,
    PERMISSIONS.EXPENSE_DELETE,
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.LEAVE_CREATE,
    PERMISSIONS.LEAVE_READ,
    PERMISSIONS.LEAVE_UPDATE,
    PERMISSIONS.LEAVE_DELETE,
    // Own timesheets against assigned projects (no approve).
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
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
    // Consultants log their OWN timesheets against assigned projects (no approve).
    PERMISSIONS.TIMESHEET_CREATE,
    PERMISSIONS.TIMESHEET_READ,
    PERMISSIONS.TIMESHEET_UPDATE,
    PERMISSIONS.TIMESHEET_DELETE,
    PERMISSIONS.FILE_UPLOAD,
    PERMISSIONS.FILE_READ,
    PERMISSIONS.FILE_DELETE,
    // Chat within the organization.
    PERMISSIONS.CHAT_READ,
    PERMISSIONS.CHAT_SEND,
  ],
});

/** Metadata for seeding roles (display name + scope). */
const ROLE_DEFINITIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: { name: 'Super Admin', scope: ROLE_SCOPES.PLATFORM },
  [ROLES.ORG_ADMIN]: { name: 'Organization Admin', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.VENDOR]: { name: 'Vendor', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.CONSULTANT_W2]: { name: 'Consultant (W2)', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.CONSULTANT_1099]: { name: 'Consultant (1099)', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.CONSULTANT_C2C]: { name: 'Consultant (C2C)', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.RECRUITER]: { name: 'Recruiter', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.SALES_REP]: { name: 'Sales Representative', scope: ROLE_SCOPES.ORGANIZATION },
  [ROLES.SALES_MANAGER]: { name: 'Sales Manager', scope: ROLE_SCOPES.ORGANIZATION },
});

/** Consultant roles (the "owned" roles a vendor manages). */
const CONSULTANT_ROLES = Object.freeze([
  ROLES.CONSULTANT_W2,
  ROLES.CONSULTANT_1099,
  ROLES.CONSULTANT_C2C,
]);

/**
 * Which roles each ROLE is allowed to assign when creating a user.
 * This is the guardrail that stops privilege escalation:
 *  - org_admin can create vendors and consultants (not super_admin, not other org_admins by default).
 *  - vendor can ONLY create consultants.
 *  - super_admin is unrestricted (handled in code, bypasses this map).
 */
const ASSIGNABLE_ROLES_BY_ROLE = Object.freeze({
  [ROLES.ORG_ADMIN]: [
    ROLES.VENDOR,
    ROLES.CONSULTANT_W2,
    ROLES.CONSULTANT_1099,
    ROLES.CONSULTANT_C2C,
    // Org admins create recruiters (who then run the ATS).
    ROLES.RECRUITER,
    // Org admins create the sales team.
    ROLES.SALES_REP,
    ROLES.SALES_MANAGER,
  ],
  [ROLES.VENDOR]: [ROLES.CONSULTANT_W2, ROLES.CONSULTANT_1099, ROLES.CONSULTANT_C2C],
});

/**
 * Legacy alias kept for the org-level assignable set (used by validation).
 * Union of everything an org-scoped actor could assign.
 */
const ORG_ASSIGNABLE_ROLES = Object.freeze([
  ROLES.ORG_ADMIN,
  ROLES.VENDOR,
  ROLES.CONSULTANT_W2,
  ROLES.CONSULTANT_1099,
  ROLES.CONSULTANT_C2C,
  ROLES.RECRUITER,
  ROLES.SALES_REP,
  ROLES.SALES_MANAGER,
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
