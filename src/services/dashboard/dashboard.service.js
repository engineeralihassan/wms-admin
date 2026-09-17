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
  Timesheet,
  UserProfile,
  UserDocument,
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
  TIMESHEET_STATUS_BUCKETS,
  TIMESHEET_CHART_WEEKS,
  TIMESHEET_DUE_SOON_DAYS,
  TODO_TYPES,
  TODO_SEVERITIES,
  VISA_EXPIRY_WARN_DAYS,
  TODO_SOURCE_LIMIT,
  DASHBOARD_DETAIL_PATHS,
  currentMonthUtcRange,
  toUtcDateString,
} = require('../../utils/dashboard.constants');
const { LEAVE_STATUSES } = require('../../utils/leave.constants');
const { TICKET_STATUSES, TICKET_PRIORITIES } = require('../../utils/ticket.constants');
const { EXPENSE_STATUSES } = require('../../utils/expense.constants');
const { PROJECT_STATUSES } = require('../../utils/project.constants');
const { TIMESHEET_STATUSES } = require('../../utils/timesheet.constants');
const { VISA_STATUSES, visaRequiresExpiry } = require('../../config/profile.constants');
const { USER_DOCUMENT_TYPES } = require('../../config/user-documents');

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

/**
 * Timesheet visibility: approvers (timesheet.approve — org admins) see all org
 * timesheets; everyone else sees only their own. Mirrors buildTimesheetScope in the
 * timesheet service so dashboard counts never exceed the caller's list view.
 */
const timesheetScope = (req) => {
  const where = tenantBase(req);
  if (!has(req.auth, PERMISSIONS.TIMESHEET_APPROVE)) {
    where.user_id = req.auth.userId;
  }
  return where;
};

/**
 * Whether the caller sees VISA/work-authorization data org-wide (an org admin, via
 * user.read) or only their OWN. Used to scope the visa-expiry todo source.
 */
const seesOrgWideUsers = (req) => has(req.auth, PERMISSIONS.USER_READ);

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

/**
 * TIMESHEETS — 5 status bars over a rolling window of the most recent N weeks. Counted
 * by CURRENT status (a timesheet's status is a live attribute), scoped so approvers see
 * the whole org and normal users see only their own. A single grouped query.
 *
 * The window is expressed on week_start_date (indexed) so it stays cheap even for a
 * large org; older, long-settled weeks are excluded to keep the chart relevant.
 */
const getTimesheetChart = async (req) => {
  const range = currentMonthUtcRange();
  const windowStart = new Date(Date.now() - TIMESHEET_CHART_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const where = {
    ...timesheetScope(req),
    week_start_date: { [Op.gte]: toUtcDateString(windowStart) },
  };
  const byStatus = await countByColumn(Timesheet, 'status', where);
  const series = toSeries(TIMESHEET_STATUS_BUCKETS, (b) => byStatus.get(b.key));
  return chartPayload(DASHBOARD_MODULES.TIMESHEETS, 'Timesheets — recent weeks', series, range);
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

// ── To-dos (personal, actionable list) ───────────────────────────────────────────
//
// Distinct from the summary cards (which are navigational counts). A todo is a single
// thing a person must ACT on, with a title, description, severity and a CTA. Sources
// are permission-scoped exactly like the rest of the dashboard: a normal user sees only
// their own; an org admin (user.read / timesheet.approve) sees the org's.

const startOfUtcDay = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Whole days from `today` (UTC) to `dateStr` (YYYY-MM-DD). Negative = already past. */
const daysUntil = (dateStr, today = startOfUtcDay()) => {
  const target = startOfUtcDay(new Date(dateStr));
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

/**
 * VISA-EXPIRY todos. A person's work authorization is expiring within the warn window
 * (default 30 days) or has already expired. Source of truth is UserProfile.work_permit
 * .visa_expiration_date; we only consider statuses that actually require an expiry
 * (permanent statuses like US citizen / green card are skipped).
 *
 * Scope: an org-wide viewer (user.read) sees everyone in their tenant; a normal user
 * sees only their own profile. The window is applied as an indexed-friendly bound on
 * the JSONB date so we never scan the whole table.
 */
const getVisaExpiryTodos = async (req) => {
  const orgWide = seesOrgWideUsers(req);
  const base = tenantBase(req); // { organization_id } (or {} for super admin)

  const where = { ...base };
  if (!orgWide) {
    where.user_id = req.auth.userId;
  }

  // Bound the JSONB date to [-∞, today + warn window]: anything expiring within the
  // window OR already expired. Non-time-bound statuses are filtered out in JS (the set
  // is tiny and status-dependent), so we keep the SQL simple and index-friendly.
  const today = startOfUtcDay();
  const horizon = new Date(today.getTime() + VISA_EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);
  const horizonStr = toUtcDateString(horizon);

  const rows = await UserProfile.findAll({
    where: {
      ...where,
      [Op.and]: [
        literal(`("UserProfile"."work_permit"->>'visa_expiration_date') IS NOT NULL`),
        literal(`("UserProfile"."work_permit"->>'visa_expiration_date') <> ''`),
        literal(
          `("UserProfile"."work_permit"->>'visa_expiration_date')::date <= '${horizonStr}'`
        ),
      ],
    },
    attributes: ['user_id', 'work_permit'],
    include: [{ model: User, as: 'user', attributes: ['uuid', 'first_name', 'last_name'] }],
    order: [
      [literal(`("UserProfile"."work_permit"->>'visa_expiration_date')::date`), 'ASC'],
    ],
    limit: TODO_SOURCE_LIMIT + 1, // one extra to detect overflow
    subQuery: false,
  });

  const todos = [];
  for (const p of rows) {
    const wp = p.work_permit || {};
    const status = wp.visa_status;
    // Skip permanent statuses defensively (shouldn't have a date, but be safe).
    if (!visaRequiresExpiry(status)) continue;
    const rawExpiry = wp.visa_expiration_date;
    if (!rawExpiry) continue;
    // Normalize to a clean YYYY-MM-DD (the JSONB value may carry a time component).
    const expiry = toUtcDateString(startOfUtcDay(new Date(rawExpiry)));

    const days = daysUntil(expiry);
    const expired = days < 0;
    const who = p.user
      ? `${p.user.first_name} ${p.user.last_name}`.trim()
      : 'A team member';
    const isMe = p.user_id === req.auth.userId;

    todos.push({
      key: `${TODO_TYPES.VISA_EXPIRY}:${p.user ? p.user.uuid : p.user_id}`,
      type: TODO_TYPES.VISA_EXPIRY,
      // Work-authorization expiry is ALWAYS a high alert (red + blinking), whether it's
      // already expired or approaching — losing authorization has hard legal/payroll
      // consequences, so it never sits in the calmer "warning" tier.
      severity: TODO_SEVERITIES.DANGER,
      title: isMe
        ? expired
          ? 'Your work authorization has expired'
          : 'Your work authorization is expiring soon'
        : expired
          ? `${who}'s work authorization has expired`
          : `${who}'s work authorization is expiring soon`,
      description: expired
        ? `Expired on ${expiry}. Upload a renewed document and update the expiration date.`
        : `Expires on ${expiry} (${days} day${days === 1 ? '' : 's'} left). Upload a renewed document and update the expiration date.`,
      actionLabel: isMe ? 'Update work authorization' : 'View profile',
      // Self → the profile page (existing upload + expiry flow). Others → that user's
      // admin profile detail page.
      actionPath: isMe ? '/profile' : `/users/${p.user ? p.user.uuid : ''}`,
      meta: {
        expiry_date: expiry,
        days_until: days,
        visa_status: status,
        user_uuid: p.user ? p.user.uuid : null,
        is_self: isMe,
      },
    });
  }
  return todos;
};

/**
 * TIMESHEET todos. Every unsubmitted sheet that needs attention within the near-term
 * window, in three flavours by urgency:
 *   - locking_soon  (danger)  — past due and the hard lock is within the window; after
 *                                the lock date the owner is frozen out. Most urgent.
 *   - overdue       (danger)  — past due but not yet locking within the window.
 *   - due_soon      (warning) — not yet due, but the due date is within the window.
 *
 * We fetch every unsubmitted sheet whose LOCK date hasn't passed and whose DUE date is
 * within [today, today + window] OR already past — one indexed query — then classify in
 * JS. Approvers see the org's sheets; a normal user sees only their own.
 */
const getTimesheetTodos = async (req) => {
  const today = startOfUtcDay();
  const todayStr = toUtcDateString(today);
  const horizon = new Date(today.getTime() + TIMESHEET_DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const horizonStr = toUtcDateString(horizon);

  const rows = await Timesheet.findAll({
    where: {
      ...timesheetScope(req),
      status: TIMESHEET_STATUSES.UNSUBMITTED,
      // Only sheets the owner can still act on (lock hasn't passed)…
      lock_date: { [Op.gte]: todayStr },
      // …and that are already due OR coming due within the window.
      due_date: { [Op.lte]: horizonStr },
    },
    attributes: [
      'uuid',
      'user_id',
      'week_start_date',
      'week_end_date',
      'due_date',
      'lock_date',
    ],
    include: [
      { model: User, as: 'owner', attributes: ['uuid', 'first_name', 'last_name'] },
      { model: Project, as: 'project', attributes: ['uuid', 'name', 'project_code'] },
    ],
    // Soonest lock first (most urgent), then soonest due.
    order: [
      ['lock_date', 'ASC'],
      ['due_date', 'ASC'],
    ],
    limit: TODO_SOURCE_LIMIT + 1,
    subQuery: false,
  });

  return rows.map((t) => {
    const isMe = t.user_id === req.auth.userId;
    const who = t.owner ? `${t.owner.first_name} ${t.owner.last_name}`.trim() : 'A team member';
    const projectName = t.project ? t.project.name : 'a project';
    const daysToDue = daysUntil(t.due_date, today);
    const daysToLock = daysUntil(t.lock_date, today);
    const overdue = daysToDue < 0;
    const lockingSoon = overdue && daysToLock >= 0 && daysToLock <= TIMESHEET_DUE_SOON_DAYS;

    // Classify → severity + phrasing.
    let phase;
    let severity;
    if (lockingSoon) {
      phase = 'locking_soon';
      severity = TODO_SEVERITIES.DANGER;
    } else if (overdue) {
      phase = 'overdue';
      severity = TODO_SEVERITIES.DANGER;
    } else {
      phase = 'due_soon';
      severity = TODO_SEVERITIES.WARNING;
    }

    const week = `${t.week_start_date} – ${t.week_end_date}`;
    const subject = isMe ? 'Your' : `${who}'s`;
    let title;
    let description;
    if (phase === 'locking_soon') {
      const d = daysToLock;
      title = `${subject} timesheet for ${projectName} locks ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}`;
      description = `Week ${week} is overdue and locks on ${t.lock_date}. After that it can only be changed by an approver.`;
    } else if (phase === 'overdue') {
      const d = -daysToDue;
      title = `${subject} timesheet for ${projectName} is overdue`;
      description = `Week ${week} was due ${t.due_date} (${d} day${d === 1 ? '' : 's'} overdue). It locks on ${t.lock_date}.`;
    } else {
      const d = daysToDue;
      title = `${subject} timesheet for ${projectName} is due ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}`;
      description = `Week ${week} is due ${t.due_date}. Submit it before it locks on ${t.lock_date}.`;
    }

    return {
      key: `${TODO_TYPES.TIMESHEET_UNSUBMITTED}:${t.uuid}`,
      type: TODO_TYPES.TIMESHEET_UNSUBMITTED,
      severity,
      title,
      description,
      actionLabel: isMe ? 'Open timesheet' : 'Review timesheet',
      // Deep-link straight to this specific timesheet's detail page (…/timesheets/:uuid)
      // so the CTA opens the exact week, not the whole list.
      actionPath: `/timesheets/${t.uuid}`,
      meta: {
        timesheet_uuid: t.uuid,
        project_uuid: t.project ? t.project.uuid : null,
        project_name: t.project ? t.project.name : null,
        week_start_date: t.week_start_date,
        week_end_date: t.week_end_date,
        due_date: t.due_date,
        lock_date: t.lock_date,
        days_to_due: daysToDue,
        days_to_lock: daysToLock,
        phase,
        is_self: isMe,
      },
    };
  });
};

/**
 * Assemble the caller's todo list from every permitted source, in parallel. Each source
 * is independently permission-gated so, e.g., a caller with no timesheet read never runs
 * that query. Sources are capped (TODO_SOURCE_LIMIT) and we report an `overflow` count so
 * the UI can show "+N more" and link to the module page for the full list.
 */
const getTodos = async (req) => {
  const { auth } = req;
  const sources = [];

  // Visa: any authenticated user can see their OWN; org-wide needs user.read. There's
  // no dedicated "profile read" permission, so self-view is always allowed here (the
  // data is the caller's own, exactly like /dashboard/me).
  sources.push(
    getVisaExpiryTodos(req).then((items) => ({ type: TODO_TYPES.VISA_EXPIRY, items }))
  );

  // Timesheets: only if the caller can read timesheets at all.
  if (has(auth, PERMISSIONS.TIMESHEET_READ)) {
    sources.push(
      getTimesheetTodos(req).then((items) => ({
        type: TODO_TYPES.TIMESHEET_UNSUBMITTED,
        items,
      }))
    );
  }

  const results = await Promise.all(sources);

  const todos = [];
  let overflow = 0;
  for (const { items } of results) {
    if (items.length > TODO_SOURCE_LIMIT) {
      overflow += items.length - TODO_SOURCE_LIMIT;
      todos.push(...items.slice(0, TODO_SOURCE_LIMIT));
    } else {
      todos.push(...items);
    }
  }

  // Danger before warning; within a severity, keep the source's own ordering (soonest
  // expiry / most overdue first).
  const severityRank = { [TODO_SEVERITIES.DANGER]: 0, [TODO_SEVERITIES.WARNING]: 1 };
  todos.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  return { items: todos, overflow };
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
  getTimesheetChart,
  getSummary,
  getTodos,
  getRecentProjects,
  getRecentUrgentTickets,
};
