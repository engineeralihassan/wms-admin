const User = require('./user.model');
const UserProfile = require('./user-profile.model');
const UserDocument = require('./user-document.model');
const VendorProfile = require('./vendor-profile.model');
const Token = require('./token.model');
const Organization = require('./organization.model');
const Role = require('./role.model');
const Permission = require('./permission.model');
const RolePermission = require('./role-permission.model');
const EmailJob = require('./email-job.model');
const Ticket = require('./ticket.model');
const Expense = require('./expense.model');
const Project = require('./project.model');
const ProjectMember = require('./project-member.model');
const LeaveType = require('./leave-type.model');
const LeaveBalance = require('./leave-balance.model');
const LeaveRequest = require('./leave-request.model');
const LeaveBalanceLedger = require('./leave-balance-ledger.model');
const Attachment = require('./attachment.model');
const Job = require('./job.model');
const JobApplication = require('./job-application.model');
const ApplicationEvent = require('./application-event.model');
const ResumeScreeningJob = require('./resume-screening-job.model');

/**
 * Registers all models and their associations on the shared sequelize instance.
 *
 * Relationship graph:
 *   Organization 1───* User          (a user belongs to one org; super_admin has none)
 *   Role         1───* User          (a user has one role)
 *   Organization 1───* Role          (custom org roles; system roles have org = null)
 *   Role         *───* Permission    (via role_permissions)
 *   User         1───* Token         (refresh tokens etc.)
 *   User         1───* User          (manager owns managed users; vendor -> consultants)
 *   Organization 1───* Ticket        (tenant-scoped tickets)
 *   User         1───* Ticket        (creator: created_by_id)
 *   User         1───* Ticket        (assignee: assigned_to_id, nullable)
 *   Organization 1───* Expense       (tenant-scoped expense claims)
 *   User         1───* Expense       (creator/claimant: created_by_id)
 *   User         1───* Expense       (reviewer: reviewed_by_id, nullable)
 *   Organization 1───* Project       (tenant-scoped projects)
 *   User         1───* Project       (creator: created_by_id)
 *   User         1───* Project       (lead: lead_id, nullable)
 *   Project      *───* User          (members, through project_members)
 */
const definitions = (sequelize, Sequelize) => {
  const db = {};
  db.Sequelize = Sequelize;
  db.sequelize = sequelize;

  db.User = User(sequelize);
  db.UserProfile = UserProfile(sequelize);
  db.UserDocument = UserDocument(sequelize);
  db.VendorProfile = VendorProfile(sequelize);
  db.Token = Token(sequelize);
  db.Organization = Organization(sequelize);
  db.Role = Role(sequelize);
  db.Permission = Permission(sequelize);
  db.RolePermission = RolePermission(sequelize);
  db.EmailJob = EmailJob(sequelize);
  db.Ticket = Ticket(sequelize);
  db.Expense = Expense(sequelize);
  db.Project = Project(sequelize);
  db.ProjectMember = ProjectMember(sequelize);
  db.LeaveType = LeaveType(sequelize);
  db.LeaveBalance = LeaveBalance(sequelize);
  db.LeaveRequest = LeaveRequest(sequelize);
  db.LeaveBalanceLedger = LeaveBalanceLedger(sequelize);
  db.Attachment = Attachment(sequelize);
  db.Job = Job(sequelize);
  db.JobApplication = JobApplication(sequelize);
  db.ApplicationEvent = ApplicationEvent(sequelize);
  db.ResumeScreeningJob = ResumeScreeningJob(sequelize);

  // Organization <-> User
  db.Organization.hasMany(db.User, { foreignKey: 'organization_id', as: 'users' });
  db.User.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // Role <-> User
  db.Role.hasMany(db.User, { foreignKey: 'role_id', as: 'users' });
  db.User.belongsTo(db.Role, { foreignKey: 'role_id', as: 'role' });

  // Organization <-> Role (custom roles per org)
  db.Organization.hasMany(db.Role, { foreignKey: 'organization_id', as: 'roles' });
  db.Role.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // Role <-> Permission (many-to-many through role_permissions)
  db.Role.belongsToMany(db.Permission, {
    through: db.RolePermission,
    foreignKey: 'role_id',
    otherKey: 'permission_id',
    as: 'permissions',
  });
  db.Permission.belongsToMany(db.Role, {
    through: db.RolePermission,
    foreignKey: 'permission_id',
    otherKey: 'role_id',
    as: 'roles',
  });

  // User <-> Token
  db.User.hasMany(db.Token, { foreignKey: 'user_id', as: 'tokens' });
  db.Token.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });

  // User <-> UserProfile (1-to-1: the rich Odoo-style profile)
  db.User.hasOne(db.UserProfile, { foreignKey: 'user_id', as: 'profile' });
  db.UserProfile.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
  db.UserProfile.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  // Profile -> vendor (the vendor user a C2C consultant works through)
  db.UserProfile.belongsTo(db.User, { foreignKey: 'vendor_id', as: 'vendor' });

  // User <-> UserDocument (1-to-many: profile documents)
  db.User.hasMany(db.UserDocument, { foreignKey: 'user_id', as: 'documents' });
  db.UserDocument.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
  db.UserDocument.belongsTo(db.User, { foreignKey: 'uploaded_by_id', as: 'uploadedBy' });
  db.UserDocument.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });

  // User <-> VendorProfile (1-to-1: a vendor user's company details)
  db.User.hasOne(db.VendorProfile, { foreignKey: 'user_id', as: 'vendorProfile' });
  db.VendorProfile.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
  db.VendorProfile.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });

  // User <-> User (ownership hierarchy: a manager owns many managed users)
  db.User.hasMany(db.User, { foreignKey: 'manager_id', as: 'managedUsers' });
  db.User.belongsTo(db.User, { foreignKey: 'manager_id', as: 'manager' });

  // Organization <-> Ticket (tenant scope)
  db.Organization.hasMany(db.Ticket, { foreignKey: 'organization_id', as: 'tickets' });
  db.Ticket.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // User <-> Ticket (creator + assignee, two distinct associations)
  db.User.hasMany(db.Ticket, { foreignKey: 'created_by_id', as: 'createdTickets' });
  db.Ticket.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'creator' });
  db.User.hasMany(db.Ticket, { foreignKey: 'assigned_to_id', as: 'assignedTickets' });
  db.Ticket.belongsTo(db.User, { foreignKey: 'assigned_to_id', as: 'assignee' });

  // Organization <-> Expense (tenant scope)
  db.Organization.hasMany(db.Expense, { foreignKey: 'organization_id', as: 'expenses' });
  db.Expense.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // User <-> Expense (creator/claimant + reviewer, two distinct associations)
  db.User.hasMany(db.Expense, { foreignKey: 'created_by_id', as: 'createdExpenses' });
  db.Expense.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'creator' });
  db.User.hasMany(db.Expense, { foreignKey: 'reviewed_by_id', as: 'reviewedExpenses' });
  db.Expense.belongsTo(db.User, { foreignKey: 'reviewed_by_id', as: 'reviewer' });

  // Organization <-> Project (tenant scope)
  db.Organization.hasMany(db.Project, { foreignKey: 'organization_id', as: 'projects' });
  db.Project.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // User <-> Project (creator + lead, two distinct associations)
  db.User.hasMany(db.Project, { foreignKey: 'created_by_id', as: 'createdProjects' });
  db.Project.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'creator' });
  db.User.hasMany(db.Project, { foreignKey: 'lead_id', as: 'ledProjects' });
  db.Project.belongsTo(db.User, { foreignKey: 'lead_id', as: 'lead' });

  // Project <-> User (many-to-many membership through project_members)
  db.Project.belongsToMany(db.User, {
    through: db.ProjectMember,
    foreignKey: 'project_id',
    otherKey: 'user_id',
    as: 'members',
  });
  db.User.belongsToMany(db.Project, {
    through: db.ProjectMember,
    foreignKey: 'user_id',
    otherKey: 'project_id',
    as: 'projects',
  });

  // Direct access to the join rows (needed to read member_role / audit fields).
  db.Project.hasMany(db.ProjectMember, { foreignKey: 'project_id', as: 'memberships' });
  db.ProjectMember.belongsTo(db.Project, { foreignKey: 'project_id', as: 'project' });
  db.User.hasMany(db.ProjectMember, { foreignKey: 'user_id', as: 'projectMemberships' });
  db.ProjectMember.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
  db.ProjectMember.belongsTo(db.User, { foreignKey: 'added_by_id', as: 'addedBy' });

  // ── Leave Management ──────────────────────────────────────────────────────

  // Organization <-> LeaveType (tenant scope)
  db.Organization.hasMany(db.LeaveType, { foreignKey: 'organization_id', as: 'leaveTypes' });
  db.LeaveType.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  db.LeaveType.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'creator' });

  // Organization <-> LeaveBalance (tenant scope)
  db.Organization.hasMany(db.LeaveBalance, { foreignKey: 'organization_id', as: 'leaveBalances' });
  db.LeaveBalance.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  // User <-> LeaveBalance (balance owner)
  db.User.hasMany(db.LeaveBalance, { foreignKey: 'user_id', as: 'leaveBalances' });
  db.LeaveBalance.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });
  // LeaveType <-> LeaveBalance
  db.LeaveType.hasMany(db.LeaveBalance, { foreignKey: 'leave_type_id', as: 'balances' });
  db.LeaveBalance.belongsTo(db.LeaveType, { foreignKey: 'leave_type_id', as: 'leaveType' });

  // Organization <-> LeaveRequest (tenant scope)
  db.Organization.hasMany(db.LeaveRequest, { foreignKey: 'organization_id', as: 'leaveRequests' });
  db.LeaveRequest.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  // User <-> LeaveRequest (applicant + reviewer, two distinct associations)
  db.User.hasMany(db.LeaveRequest, { foreignKey: 'created_by_id', as: 'createdLeaveRequests' });
  db.LeaveRequest.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'applicant' });
  db.User.hasMany(db.LeaveRequest, { foreignKey: 'reviewed_by_id', as: 'reviewedLeaveRequests' });
  db.LeaveRequest.belongsTo(db.User, { foreignKey: 'reviewed_by_id', as: 'reviewer' });
  // LeaveType <-> LeaveRequest
  db.LeaveType.hasMany(db.LeaveRequest, { foreignKey: 'leave_type_id', as: 'requests' });
  db.LeaveRequest.belongsTo(db.LeaveType, { foreignKey: 'leave_type_id', as: 'leaveType' });

  // LeaveBalance <-> LeaveBalanceLedger (audit trail)
  db.Organization.hasMany(db.LeaveBalanceLedger, {
    foreignKey: 'organization_id',
    as: 'leaveBalanceLedger',
  });
  db.LeaveBalanceLedger.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });
  db.LeaveBalance.hasMany(db.LeaveBalanceLedger, {
    foreignKey: 'leave_balance_id',
    as: 'ledgerEntries',
  });
  db.LeaveBalanceLedger.belongsTo(db.LeaveBalance, {
    foreignKey: 'leave_balance_id',
    as: 'balance',
  });
  db.LeaveRequest.hasMany(db.LeaveBalanceLedger, {
    foreignKey: 'leave_request_id',
    as: 'ledgerEntries',
  });
  db.LeaveBalanceLedger.belongsTo(db.LeaveRequest, {
    foreignKey: 'leave_request_id',
    as: 'leaveRequest',
  });

  // ── ATS (Jobs & Applications) ──────────────────────────────────────────────

  // Organization <-> Job (tenant scope)
  db.Organization.hasMany(db.Job, { foreignKey: 'organization_id', as: 'jobs' });
  db.Job.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  // User(recruiter) <-> Job (creator/owner)
  db.User.hasMany(db.Job, { foreignKey: 'created_by_id', as: 'createdJobs' });
  db.Job.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'recruiter' });

  // Organization <-> JobApplication (tenant scope)
  db.Organization.hasMany(db.JobApplication, {
    foreignKey: 'organization_id',
    as: 'jobApplications',
  });
  db.JobApplication.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });
  // Job <-> JobApplication
  db.Job.hasMany(db.JobApplication, { foreignKey: 'job_id', as: 'applications' });
  db.JobApplication.belongsTo(db.Job, { foreignKey: 'job_id', as: 'job' });
  // User(reviewer) <-> JobApplication (nullable until acted on)
  db.User.hasMany(db.JobApplication, {
    foreignKey: 'reviewed_by_id',
    as: 'reviewedApplications',
  });
  db.JobApplication.belongsTo(db.User, { foreignKey: 'reviewed_by_id', as: 'reviewer' });

  // Organization <-> ApplicationEvent (tenant scope)
  db.Organization.hasMany(db.ApplicationEvent, {
    foreignKey: 'organization_id',
    as: 'applicationEvents',
  });
  db.ApplicationEvent.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });
  // JobApplication <-> ApplicationEvent (audit trail)
  db.JobApplication.hasMany(db.ApplicationEvent, {
    foreignKey: 'application_id',
    as: 'events',
  });
  db.ApplicationEvent.belongsTo(db.JobApplication, {
    foreignKey: 'application_id',
    as: 'application',
  });
  // User(actor) <-> ApplicationEvent
  db.User.hasMany(db.ApplicationEvent, { foreignKey: 'created_by_id', as: 'applicationEvents' });
  db.ApplicationEvent.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'actor' });

  // JobApplication <-> ResumeScreeningJob (async screening queue). Carries only tenant
  // + application associations; the worker resolves CV + criteria at run time.
  db.JobApplication.hasMany(db.ResumeScreeningJob, {
    foreignKey: 'application_id',
    as: 'screeningJobs',
  });
  db.ResumeScreeningJob.belongsTo(db.JobApplication, {
    foreignKey: 'application_id',
    as: 'application',
  });
  db.Organization.hasMany(db.ResumeScreeningJob, {
    foreignKey: 'organization_id',
    as: 'resumeScreeningJobs',
  });
  db.ResumeScreeningJob.belongsTo(db.Organization, {
    foreignKey: 'organization_id',
    as: 'organization',
  });

  // Attachment (polymorphic file store). It is NOT tied to any single parent via a
  // FK — owner_type/owner_id resolve the parent at the service layer — so it only
  // carries tenant + uploader associations for scoping and auditing.
  db.Organization.hasMany(db.Attachment, { foreignKey: 'organization_id', as: 'attachments' });
  db.Attachment.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });
  db.User.hasMany(db.Attachment, { foreignKey: 'uploaded_by_id', as: 'uploadedAttachments' });
  db.Attachment.belongsTo(db.User, { foreignKey: 'uploaded_by_id', as: 'uploadedBy' });

  return db;
};

module.exports = definitions;
