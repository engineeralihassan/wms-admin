/**
 * Dashboard domain constants — the single source of truth for the aggregation
 * widgets that power the dashboard module. Each module declares the exact ordered
 * set of "bars" its chart shows, along with the label and color used to render each
 * bar. The service produces counts per bucket; the controller zero-fills any missing
 * bucket so every chart always renders its full, stable set of bars.
 *
 * Design notes:
 *  - Bar order is significant and fixed here (charts should not reorder per request).
 *  - Colors are chosen per module/status so the frontend chart component stays purely
 *    data-driven: it renders series[].label on the x-axis, series[].value on the y-axis
 *    and series[].color as the bar color, with no per-module special-casing.
 *  - `kind` distinguishes status buckets from priority buckets for modules whose chart
 *    mixes both (tickets, projects), in case the frontend wants to group/segment them.
 *
 * Time handling is UTC calendar month for v1 (per-organization timezone is phase 2).
 */

const { LEAVE_STATUSES } = require('./leave.constants');
const { TICKET_STATUSES, TICKET_PRIORITIES } = require('./ticket.constants');
const { EXPENSE_STATUSES } = require('./expense.constants');
const { PROJECT_STATUSES, PROJECT_PRIORITIES } = require('./project.constants');

/** Bucket "kinds" — lets a mixed chart segment status vs priority bars. */
const BUCKET_KINDS = Object.freeze({
  STATUS: 'status',
  PRIORITY: 'priority',
  METRIC: 'metric',
});

/** Module keys used in the normalized chart payload and to pick a config. */
const DASHBOARD_MODULES = Object.freeze({
  LEAVES: 'leaves',
  TICKETS: 'tickets',
  EXPENSES: 'expenses',
  PROJECTS: 'projects',
  USERS: 'users',
  ORGANIZATIONS: 'organizations',
});

/**
 * LEAVES — 5 status bars (draft intentionally excluded; drafts are not meaningful
 * "leaves this month"). Counts leave requests created within the current UTC month.
 */
const LEAVE_CHART_BUCKETS = Object.freeze([
  { key: LEAVE_STATUSES.SUBMITTED, label: 'Submitted', color: '#f59e0b', kind: BUCKET_KINDS.STATUS },
  { key: LEAVE_STATUSES.APPROVED, label: 'Approved', color: '#16a34a', kind: BUCKET_KINDS.STATUS },
  { key: LEAVE_STATUSES.REJECTED, label: 'Rejected', color: '#dc2626', kind: BUCKET_KINDS.STATUS },
  { key: LEAVE_STATUSES.WITHDRAWN, label: 'Withdrawn', color: '#6b7280', kind: BUCKET_KINDS.STATUS },
  { key: LEAVE_STATUSES.CANCELLED, label: 'Cancelled', color: '#9ca3af', kind: BUCKET_KINDS.STATUS },
]);

/**
 * TICKETS — 6 bars: 3 priorities (medium/high/urgent) + 3 statuses
 * (open/in_progress/resolved). Priority and status are two independent columns, so
 * these are counted with two separate grouped queries and merged in fixed order.
 */
const TICKET_PRIORITY_BUCKETS = Object.freeze([
  { key: TICKET_PRIORITIES.MEDIUM, label: 'Medium', color: '#3b82f6', kind: BUCKET_KINDS.PRIORITY },
  { key: TICKET_PRIORITIES.HIGH, label: 'High', color: '#f97316', kind: BUCKET_KINDS.PRIORITY },
  { key: TICKET_PRIORITIES.URGENT, label: 'Urgent', color: '#dc2626', kind: BUCKET_KINDS.PRIORITY },
]);
const TICKET_STATUS_BUCKETS = Object.freeze([
  { key: TICKET_STATUSES.OPEN, label: 'Open', color: '#0ea5e9', kind: BUCKET_KINDS.STATUS },
  { key: TICKET_STATUSES.IN_PROGRESS, label: 'In Progress', color: '#8b5cf6', kind: BUCKET_KINDS.STATUS },
  { key: TICKET_STATUSES.RESOLVED, label: 'Resolved', color: '#16a34a', kind: BUCKET_KINDS.STATUS },
]);

/**
 * EXPENSES — 4 bars: a "Total" metric (count of all expenses this month) + 3 status
 * bars (submitted/approved/rejected). Draft is excluded from the status bars; the
 * Total bar still counts everything created this month.
 */
const EXPENSE_STATUS_BUCKETS = Object.freeze([
  { key: EXPENSE_STATUSES.SUBMITTED, label: 'Submitted', color: '#f59e0b', kind: BUCKET_KINDS.STATUS },
  { key: EXPENSE_STATUSES.APPROVED, label: 'Approved', color: '#16a34a', kind: BUCKET_KINDS.STATUS },
  { key: EXPENSE_STATUSES.REJECTED, label: 'Rejected', color: '#dc2626', kind: BUCKET_KINDS.STATUS },
]);
const EXPENSE_TOTAL_BUCKET = Object.freeze({
  key: 'total',
  label: 'Total',
  color: '#0f766e',
  kind: BUCKET_KINDS.METRIC,
});

/**
 * PROJECTS — 6 bars: 4 statuses (planned/active/completed/on_hold) + 2 priorities
 * (medium/high). Two independent columns => two grouped queries merged in fixed order.
 * Projects are counted by CURRENT state (not "created this month"); a project's status
 * is a live attribute, so the chart reflects the org's current portfolio.
 */
const PROJECT_STATUS_BUCKETS = Object.freeze([
  { key: PROJECT_STATUSES.PLANNED, label: 'Planned', color: '#3b82f6', kind: BUCKET_KINDS.STATUS },
  { key: PROJECT_STATUSES.ACTIVE, label: 'Active', color: '#16a34a', kind: BUCKET_KINDS.STATUS },
  { key: PROJECT_STATUSES.COMPLETED, label: 'Completed', color: '#0f766e', kind: BUCKET_KINDS.STATUS },
  { key: PROJECT_STATUSES.ON_HOLD, label: 'On Hold', color: '#f59e0b', kind: BUCKET_KINDS.STATUS },
]);
const PROJECT_PRIORITY_BUCKETS = Object.freeze([
  { key: PROJECT_PRIORITIES.MEDIUM, label: 'Medium', color: '#8b5cf6', kind: BUCKET_KINDS.PRIORITY },
  { key: PROJECT_PRIORITIES.HIGH, label: 'High', color: '#dc2626', kind: BUCKET_KINDS.PRIORITY },
]);

/**
 * USERS — metric bars describing the org's people. These are computed with targeted
 * COUNTs rather than a single GROUP BY because they answer different questions:
 *   total     — all users in scope
 *   active    — status = active
 *   invited   — status = invited (pending activation)
 *   new       — created within the current UTC month
 */
const USER_METRIC_BUCKETS = Object.freeze([
  { key: 'total', label: 'Total', color: '#0f766e', kind: BUCKET_KINDS.METRIC },
  { key: 'active', label: 'Active', color: '#16a34a', kind: BUCKET_KINDS.METRIC },
  { key: 'invited', label: 'Invited', color: '#f59e0b', kind: BUCKET_KINDS.METRIC },
  { key: 'new', label: 'New This Month', color: '#3b82f6', kind: BUCKET_KINDS.METRIC },
]);

/**
 * ORGANIZATIONS — super-admin-only chart, 4 metric bars. Organization "status" is the
 * boolean is_active (there is no status enum), so active/inactive are derived from it.
 *   total     — all organizations
 *   active    — is_active = true
 *   inactive  — is_active = false
 *   new       — created within the current UTC month
 */
const ORGANIZATION_METRIC_BUCKETS = Object.freeze([
  { key: 'total', label: 'Total', color: '#0f766e', kind: BUCKET_KINDS.METRIC },
  { key: 'active', label: 'Active', color: '#16a34a', kind: BUCKET_KINDS.METRIC },
  { key: 'inactive', label: 'Inactive', color: '#9ca3af', kind: BUCKET_KINDS.METRIC },
  { key: 'new', label: 'New This Month', color: '#3b82f6', kind: BUCKET_KINDS.METRIC },
]);

/** Frontend deep-link targets for each chart's "View details" button. */
const DASHBOARD_DETAIL_PATHS = Object.freeze({
  [DASHBOARD_MODULES.LEAVES]: '/leaves',
  [DASHBOARD_MODULES.TICKETS]: '/tickets',
  [DASHBOARD_MODULES.EXPENSES]: '/expenses',
  [DASHBOARD_MODULES.PROJECTS]: '/projects',
  [DASHBOARD_MODULES.USERS]: '/users',
  [DASHBOARD_MODULES.ORGANIZATIONS]: '/organizations',
});

/** How many rows the "recent" side-panel lists return. */
const RECENT_LIST_LIMIT = 3;

/**
 * Current-month UTC window as [start, end): first instant of this UTC month up to the
 * first instant of next month. Half-open so it maps cleanly to `created_at >= start
 * AND created_at < end` without off-by-one at month boundaries.
 */
const currentMonthUtcRange = (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
};

/** ISO date (YYYY-MM-DD) of a Date's UTC calendar day — for the payload `period`. */
const toUtcDateString = (date) => date.toISOString().slice(0, 10);

module.exports = {
  BUCKET_KINDS,
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
  RECENT_LIST_LIMIT,
  currentMonthUtcRange,
  toUtcDateString,
};
