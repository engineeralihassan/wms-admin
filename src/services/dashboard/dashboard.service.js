const httpStatus = require('http-status');
const { Op, fn, col, literal } = require('sequelize');
const {
  User,
  Organization,
  Role,
  Ticket,
  Expense,
  Project,
  ProjectMember,
  LeaveRequest,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { PERMISSIONS, ROLES } = require('../../config/rbac');
const {
  DASHBOARD_MODULES,
  LEAVE_CHART_BUCKETS,
  TICKET_PRIORITY_BUCKETS,
  TICKET_STATUS_BUCKETS,
  EXPENSE_STATUS_BUCKETS,
  EXPENSE_TOTAL_BUCKET,
  PROJECT_STATUS_BUCKETS,
  PROJECT_PRIORITY_BUCKETS,
  USER_METRIC_BUCKETS,
  ORGANIZATION_METRIC_BUCKETS,
  DASHBOARD_DETAIL_PATHS,
  currentMonthUtcRange,
  toUtcDateString,
} = require('../../utils/dashboard.constants');
const { LEAVE_STATUSES } = require('../../utils/leave.constants');
const { TICKET_STATUSES, TICKET_PRIORITIES } = require('../../utils/ticket.constants');
const { EXPENSE_STATUSES } = require('../../utils/expense.constants');
const { PROJECT_STATUSES } = require('../../utils/project.constants');

// ── Scope helpers ─────────────────────────────────────────────────────────────
//
// Every aggregate is built on top of the SAME tenant + per-role visibility rules the
// list endpoints use, so a widget can never surface a count the caller isn't allowed
// to see. We check PERMISSIONS (not role names) exactly like the module services.

/**
 * Assert the request passed through tenantScope (fail-closed) and return the base
 * tenant where-fragment. Mirrors buildLeaveScope's guard so a forgotten middleware
 * breaks loudly instead of leaking cross-tenant data.
 */
const tenantBase = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }
  return { ...tenantWhere };
};

const has = (auth, perm) => auth.isSuperAdmin || (auth.permissions || []).includes(perm);

/**
 * Leave visibility: approvers (leave.approve) see all org leave; everyone else sees
 * only their own requests. Matches buildLeaveScope in the leave service.
 */
const leaveScope = (req) => {
  const where = tenantBase(req);
  if (!has(req.auth, PERMISSIONS.LEAVE_APPROVE)) {
    where.created_by_id = req.auth.userId;
  }
  return where;
};

/**
 * Ticket visibility: assigners (ticket.assign — org admins) see all org tickets;
 * normal users see tickets they created OR are assigned to.
 */
const ticketScope = (req) => {
  const where = tenantBase(req);
  if (!has(req.auth, PERMISSIONS.TICKET_ASSIGN)) {
    where[Op.or] = [
      { created_by_id: req.auth.userId },
      { assigned_to_id: req.auth.userId },
    ];
  }
  return where;
};

/**
 * Expense visibility: reviewers (expense.review) see all org expenses; everyone else
 * sees only their own claims.
 */
const expenseScope = (req) => {
  const where = tenantBase(req);
  if (!has(req.auth, PERMISSIONS.EXPENSE_REVIEW)) {
    where.created_by_id = req.auth.userId;
  }
  return where;
};

/**
 * User visibility: mirrors buildUserScope in the user service so dashboard user counts
 * NEVER exceed what the caller can see in the user list.
 *   - org_admin / super_admin: all users in scope (whole org / all orgs)
 *   - vendor: ONLY the consultants they manage (manager_id = self)
 * Without this, a vendor's "Users" chart and "Inactive users" card would leak org-wide
 * counts even though their user list is correctly narrowed to their own consultants.
 */
const userScope = (req) => {
  const where = tenantBase(req);
  if (!req.auth.isSuperAdmin && req.auth.role === ROLES.VENDOR) {
    where.manager_id = req.auth.userId;
  }
  return where;
};

/**
 * Project visibility: managers (project.manage) see all org projects; normal members
 * see only projects they belong to. We express "member of" as an EXISTS subquery on
 * project_members (indexed on (user_id, project_id)) rather than a JOIN, so it composes
 * cleanly with GROUP BY aggregation without row multiplication.
 */
const projectScope = (req) => {
  const where = tenantBase(req);
  if (!has(req.auth, PERMISSIONS.PROJECT_MANAGE)) {
    const userId = Number(req.auth.userId);
    where[Op.and] = [
      ...(where[Op.and] || []),
      literal(
        `EXISTS (SELECT 1 FROM project_members pm ` +
          `WHERE pm.project_id = "Project".id AND pm.user_id = ${userId})`
      ),
    ];
  }
  return where;
};

// ── Aggregation primitives ────────────────────────────────────────────────────

/**
 * Run a single `COUNT(*) ... GROUP BY <column>` and return a Map of value -> count.
 * SQL only returns buckets that have rows; the caller zero-fills the rest so the chart
 * always shows its full, fixed set of bars.
 */
const countByColumn = async (model, column, where) => {
  const rows = await model.findAll({
    where,
    attributes: [column, [fn('COUNT', col(`${model.name}.id`)), 'count']],
    group: [column],
    raw: true,
  });
  const map = new Map();
  rows.forEach((r) => map.set(r[column], Number(r.count)));
  return map;
};

/** Simple scoped COUNT with an extra where-fragment (used for metric bars). */
const countWhere = (model, where, extra = {}) =>
  model.count({ where: { ...where, ...extra } });

/** Map a bucket list + a value-lookup into the normalized series[] shape. */
const toSeries = (buckets, lookup) =>
  buckets.map((b) => ({
    key: b.key,
    label: b.label,
    value: Number(lookup(b) || 0),
    color: b.color,
    kind: b.kind,
  }));

/** Assemble the normalized chart payload shared by every chart endpoint. */
const chartPayload = (module, title, series, range) => ({
  module,
  title,
  detailPath: DASHBOARD_DETAIL_PATHS[module],
  period: { from: toUtcDateString(range.start), to: toUtcDateString(range.end) },
  series,
  total: series
    .filter((s) => s.kind !== 'metric' || s.key !== 'total')
    .reduce((sum, s) => sum + s.value, 0),
});

/** created_at within the current UTC month, half-open [start, end). */
const monthWindow = (range) => ({ created_at: { [Op.gte]: range.start, [Op.lt]: range.end } });

// ── Chart builders (one grouped query each) ────────────────────────────────────

/** LEAVES — 5 status bars, leave requests created this UTC month. */
const getLeaveChart = async (req) => {
  const range = currentMonthUtcRange();
  const where = { ...leaveScope(req), ...monthWindow(range) };
  const counts = await countByColumn(LeaveRequest, 'status', where);
  const series = toSeries(LEAVE_CHART_BUCKETS, (b) => counts.get(b.key));
  return chartPayload(DASHBOARD_MODULES.LEAVES, 'Leaves — this month', series, range);
};

/**
 * TICKETS — 6 bars: 3 priority + 3 status, tickets created this UTC month. Priority
 * and status are independent columns, so we run two grouped queries in parallel.
 */
const getTicketChart = async (req) => {
  const range = currentMonthUtcRange();
  const where = { ...ticketScope(req), ...monthWindow(range) };
  const [byPriority, byStatus] = await Promise.all([
    countByColumn(Ticket, 'priority', where),
    countByColumn(Ticket, 'status', where),
  ]);
  const series = [
    ...toSeries(TICKET_PRIORITY_BUCKETS, (b) => byPriority.get(b.key)),
    ...toSeries(TICKET_STATUS_BUCKETS, (b) => byStatus.get(b.key)),
  ];
  return chartPayload(DASHBOARD_MODULES.TICKETS, 'Tickets — this month', series, range);
};

/**
 * EXPENSES — 4 bars: Total (all expenses this month) + 3 status bars. One grouped
 * query gives the statuses; the Total bar is the sum of all buckets (including draft).
 */
const getExpenseChart = async (req) => {
  const range = currentMonthUtcRange();
  const where = { ...expenseScope(req), ...monthWindow(range) };
  const byStatus = await countByColumn(Expense, 'status', where);
  const total = [...byStatus.values()].reduce((s, n) => s + n, 0);
  const series = [
    { ...EXPENSE_TOTAL_BUCKET, value: total, kind: EXPENSE_TOTAL_BUCKET.kind },
    ...toSeries(EXPENSE_STATUS_BUCKETS, (b) => byStatus.get(b.key)),
  ];
  return chartPayload(DASHBOARD_MODULES.EXPENSES, 'Expenses — this month', series, range);
};

/**
 * PROJECTS — 6 bars: 4 status + 2 priority. Projects are counted by CURRENT state
 * (a project's status is a live attribute), not by "created this month", so no month
 * window is applied here. The period in the payload still reflects the current month
 * for consistent labeling on the frontend.
 */
const getProjectChart = async (req) => {
  const range = currentMonthUtcRange();
  const where = projectScope(req);
  const [byStatus, byPriority] = await Promise.all([
    countByColumn(Project, 'status', where),
    countByColumn(Project, 'priority', where),
  ]);
  const series = [
    ...toSeries(PROJECT_STATUS_BUCKETS, (b) => byStatus.get(b.key)),
    ...toSeries(PROJECT_PRIORITY_BUCKETS, (b) => byPriority.get(b.key)),
  ];
  return chartPayload(DASHBOARD_MODULES.PROJECTS, 'Projects — by status', series, range);
};

/**
 * USERS — metric bars (total / active / invited / new this month). Uses targeted
 * COUNTs run in parallel because each answers a different question. Tenant-scoped:
 * org admins see their org, super admin sees all platform users.
 */
const getUserChart = async (req) => {
  const range = currentMonthUtcRange();
  const where = userScope(req);
  const [total, active, invited, created] = await Promise.all([
    countWhere(User, where),
    countWhere(User, where, { status: 'active' }),
    countWhere(User, where, { status: 'invited' }),
    countWhere(User, where, monthWindow(range)),
  ]);
  const lookup = { total, active, invited, new: created };
  const series = toSeries(USER_METRIC_BUCKETS, (b) => lookup[b.key]);
  return chartPayload(DASHBOARD_MODULES.USERS, 'Users', series, range);
};

/**
 * ORGANIZATIONS — super-admin-only metric chart (total / active / inactive / new).
 * Organization "status" is the boolean is_active. Not tenant-scoped: this is a
 * platform-wide view and the route already gates it behind organization.read_all.
 */
const getOrganizationChart = async (req, res) => {
  if (!has(req.auth, PERMISSIONS.ORG_READ_ALL)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('forbidden'));
  }
  const range = currentMonthUtcRange();
  const [total, active, inactive, created] = await Promise.all([
    Organization.count(),
    Organization.count({ where: { is_active: true } }),
    Organization.count({ where: { is_active: false } }),
    Organization.count({ where: monthWindow(range) }),
  ]);
  const lookup = { total, active, inactive, new: created };
  const series = toSeries(ORGANIZATION_METRIC_BUCKETS, (b) => lookup[b.key]);
  return chartPayload(DASHBOARD_MODULES.ORGANIZATIONS, 'Organizations', series, range);
};

// ── Actionable summary cards ────────────────────────────────────────────────────

/**
 * The 5 actionable cards. Each is a cheap scoped COUNT of "things needing attention",
 * run in parallel. Counts respect the same visibility as the charts: a manager sees
 * org-wide pending work, a normal user sees only their own.
 */
const getSummary = async (req) => {
  const { auth } = req;

  // Each card is only meaningful for a caller who can ACT on it. We build the card set
  // per-permission so, e.g., a vendor (who cannot approve leave/expenses or manage the
  // whole org's users) doesn't see "pending approvals" / org-wide "inactive users"
  // cards that look like an org-admin view. The label also adapts: an approver sees
  // "pending approvals", a normal user sees "my submitted".
  const canApproveLeave = has(auth, PERMISSIONS.LEAVE_APPROVE);
  const canReviewExpense = has(auth, PERMISSIONS.EXPENSE_REVIEW);
  // USER_DELETE is the org-admin-distinguishing capability (vendor has create/read/update
  // for their own consultants, but NOT delete). Use it to gate the admin "Inactive users"
  // card so vendors don't get an org-admin-style view.
  const canManageUsers = has(auth, PERMISSIONS.USER_DELETE);
  const canReadTickets = has(auth, PERMISSIONS.TICKET_READ);
  const canReadProjects = has(auth, PERMISSIONS.PROJECT_READ);
  const canReadLeave = has(auth, PERMISSIONS.LEAVE_READ);
  const canReadExpense = has(auth, PERMISSIONS.EXPENSE_READ);

  const tasks = [];

  if (canReadLeave) {
    tasks.push(
      countWhere(LeaveRequest, leaveScope(req), { status: LEAVE_STATUSES.SUBMITTED }).then((value) => ({
        key: 'leave_pending',
        module: DASHBOARD_MODULES.LEAVES,
        label: canApproveLeave ? 'Leave pending approvals' : 'My submitted leaves',
        value,
        detailPath: DASHBOARD_DETAIL_PATHS[DASHBOARD_MODULES.LEAVES],
      }))
    );
  }

  if (canReadExpense) {
    tasks.push(
      countWhere(Expense, expenseScope(req), { status: EXPENSE_STATUSES.SUBMITTED }).then((value) => ({
        key: 'expense_pending',
        module: DASHBOARD_MODULES.EXPENSES,
        label: canReviewExpense ? 'Expense pending approvals' : 'My submitted expenses',
        value,
        detailPath: DASHBOARD_DETAIL_PATHS[DASHBOARD_MODULES.EXPENSES],
      }))
    );
  }

  if (canReadTickets) {
    tasks.push(
      countWhere(Ticket, ticketScope(req), {
        status: { [Op.in]: [TICKET_STATUSES.OPEN, TICKET_STATUSES.IN_PROGRESS] },
      }).then((value) => ({
        key: 'tickets_open',
        module: DASHBOARD_MODULES.TICKETS,
        label: 'Open tickets',
        value,
        detailPath: DASHBOARD_DETAIL_PATHS[DASHBOARD_MODULES.TICKETS],
      }))
    );
  }

  // "Inactive users" is an admin-style card. Only show it to callers who can actually
  // manage users org-wide (org_admin). A vendor manages their own consultants but this
  // card frames an administrative task, so we gate it on user management perms.
  if (canManageUsers) {
    tasks.push(
      countWhere(User, userScope(req), { status: { [Op.in]: ['invited', 'disabled'] } }).then(
        (value) => ({
          key: 'users_inactive',
          module: DASHBOARD_MODULES.USERS,
          label: 'Inactive users',
          value,
          detailPath: DASHBOARD_DETAIL_PATHS[DASHBOARD_MODULES.USERS],
        })
      )
    );
  }

  if (canReadProjects) {
    tasks.push(
      Project.count({ where: { ...projectScope(req), status: PROJECT_STATUSES.ACTIVE } }).then(
        (value) => ({
          key: 'projects_active',
          module: DASHBOARD_MODULES.PROJECTS,
          label: 'Active projects',
          value,
          detailPath: DASHBOARD_DETAIL_PATHS[DASHBOARD_MODULES.PROJECTS],
        })
      )
    );
  }

  return Promise.all(tasks);
};

// ── Recent side-panel lists ─────────────────────────────────────────────────────

const USER_SUMMARY_ATTRIBUTES = ['uuid', 'first_name', 'last_name', 'email'];

/** Latest N active projects (most recently created), respecting project visibility. */
const getRecentProjects = async (req, limit) => {
  const rows = await Project.findAll({
    where: { ...projectScope(req), status: PROJECT_STATUSES.ACTIVE },
    attributes: ['uuid', 'project_code', 'name', 'status', 'priority', 'start_date', 'end_date', 'created_at'],
    include: [{ model: User, as: 'lead', attributes: USER_SUMMARY_ATTRIBUTES }],
    order: [['created_at', 'DESC']],
    limit,
    subQuery: false,
  });
  return rows;
};

/** Latest N urgent-priority tickets (most recently created), respecting ticket visibility. */
const getRecentUrgentTickets = async (req, limit) => {
  const rows = await Ticket.findAll({
    where: { ...ticketScope(req), priority: TICKET_PRIORITIES.URGENT },
    attributes: ['uuid', 'ticket_number', 'subject', 'status', 'priority', 'created_at'],
    include: [{ model: User, as: 'assignee', attributes: USER_SUMMARY_ATTRIBUTES }],
    order: [['created_at', 'DESC']],
    limit,
    subQuery: false,
  });
  return rows;
};

// ── Profile card ─────────────────────────────────────────────────────────────

/** The logged-in user's profile card data (name, email, status, role, org). */
const getMe = async (req, res) => {
  const user = await User.findByPk(req.auth.userId, {
    attributes: ['uuid', 'first_name', 'last_name', 'email', 'status', 'created_at'],
    include: [
      { model: Role, as: 'role', attributes: ['key', 'name'] },
      { model: Organization, as: 'organization', attributes: ['uuid', 'name', 'slug', 'is_active'] },
    ],
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  return user;
};

module.exports = {
  getMe,
  getLeaveChart,
  getTicketChart,
  getExpenseChart,
  getProjectChart,
  getUserChart,
  getOrganizationChart,
  getSummary,
  getRecentProjects,
  getRecentUrgentTickets,
};
