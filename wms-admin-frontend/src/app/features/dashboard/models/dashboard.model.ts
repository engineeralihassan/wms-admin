/**
 * Dashboard payload shapes, mirroring the backend's dashboard module responses.
 *
 * Every chart endpoint returns the SAME normalized `ChartData` shape, so a single
 * reusable bar-chart component renders all of them with no per-module special-casing:
 * it maps series[].label -> x-axis, series[].value -> y-axis, series[].color -> bar.
 */

/** Which module a chart/card belongs to (used for deep-links and keys). */
export type DashboardModule =
  | 'leaves'
  | 'tickets'
  | 'expenses'
  | 'projects'
  | 'users'
  | 'organizations'
  | 'timesheets';

/** A bucket kind — lets a mixed chart segment status vs priority bars if needed. */
export type BucketKind = 'status' | 'priority' | 'metric';

/** One bar in a chart. */
export interface ChartSeriesPoint {
  key: string;
  label: string;
  value: number;
  color: string;
  kind: BucketKind;
}

/** The normalized chart payload shared by every dashboard chart endpoint. */
export interface ChartData {
  module: DashboardModule;
  title: string;
  /** Frontend route for the "View details" button (e.g. '/leaves'). */
  detailPath: string;
  period: { from: string; to: string };
  series: ChartSeriesPoint[];
  total: number;
}

/** A user summary embedded in recent lists. */
export interface DashboardUserSummary {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** The logged-in user's profile card. */
export interface DashboardMe {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  created_at: string;
  role: { key: string; name: string } | null;
  organization: {
    uuid: string;
    name: string;
    slug: string;
    is_active: boolean;
  } | null;
}

/** One actionable summary card. */
export interface SummaryCard {
  key: string;
  module: DashboardModule;
  label: string;
  value: number;
  detailPath: string;
}

/** What a to-do is about (mirrors backend TODO_TYPES). */
export type TodoType = 'visa_expiry' | 'timesheet_unsubmitted';

/** How urgent a to-do is (mirrors backend TODO_SEVERITIES). */
export type TodoSeverity = 'warning' | 'danger';

/**
 * One actionable to-do. Unlike a SummaryCard (a navigational count), a to-do is a
 * single thing the user must act on, with a title, description, severity and a CTA
 * that deep-links to where the action happens (e.g. /profile for visa renewal).
 */
export interface TodoItem {
  key: string;
  type: TodoType;
  severity: TodoSeverity;
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
  meta: Record<string, unknown>;
}

/** The /dashboard/todos payload: the capped item list plus a "+N more" overflow count. */
export interface TodosResponse {
  items: TodoItem[];
  overflow: number;
}

/** A recent active project (side panel). */
export interface RecentProject {
  uuid: string;
  project_code: string;
  name: string;
  status: string;
  priority: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  lead: DashboardUserSummary | null;
}

/** A recent urgent ticket (side panel). */
export interface RecentTicket {
  uuid: string;
  ticket_number: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  assignee: DashboardUserSummary | null;
}
