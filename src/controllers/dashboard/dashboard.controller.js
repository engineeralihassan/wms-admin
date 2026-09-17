const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { dashboardService } = require('../../services');
const { RECENT_LIST_LIMIT } = require('../../utils/dashboard.constants');

// ── DTO mappers (uuid-only, no internal ids leaked) ──────────────────────────

const userSummary = (user) =>
  user
    ? {
        uuid: user.uuid,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      }
    : null;

/** Profile card for the logged-in user. */
const meToDto = (user) => ({
  uuid: user.uuid,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  status: user.status,
  created_at: user.created_at,
  role: user.role ? { key: user.role.key, name: user.role.name } : null,
  organization: user.organization
    ? {
        uuid: user.organization.uuid,
        name: user.organization.name,
        slug: user.organization.slug,
        is_active: user.organization.is_active,
      }
    : null,
});

const projectToDto = (p) => ({
  uuid: p.uuid,
  project_code: p.project_code,
  name: p.name,
  status: p.status,
  priority: p.priority,
  start_date: p.start_date,
  end_date: p.end_date,
  created_at: p.created_at,
  lead: userSummary(p.lead),
});

const ticketToDto = (t) => ({
  uuid: t.uuid,
  ticket_number: t.ticket_number,
  subject: t.subject,
  status: t.status,
  priority: t.priority,
  created_at: t.created_at,
  assignee: userSummary(t.assignee),
});

// ── Handlers ─────────────────────────────────────────────────────────────────
//
// Each widget is its own endpoint so the frontend can fire them in parallel and show
// a per-widget loader. Every handler is a thin wrapper: call the service, shape the
// response, send the { message, data } envelope.

const me = catchAsync(async (req, res) => {
  const user = await dashboardService.getMe(req, res);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data: meToDto(user) });
});

const leaveChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getLeaveChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const ticketChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getTicketChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const expenseChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getExpenseChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const projectChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getProjectChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const userChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getUserChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const organizationChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getOrganizationChart(req, res);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const timesheetChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getTimesheetChart(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const summary = catchAsync(async (req, res) => {
  const data = await dashboardService.getSummary(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

/**
 * GET /dashboard/todos — the caller's personal, actionable list (visa expiry +
 * unsubmitted timesheets today; more sources can be added service-side). Already
 * shaped by the service; the controller just forwards the { items, overflow } payload.
 */
const todos = catchAsync(async (req, res) => {
  const data = await dashboardService.getTodos(req);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data });
});

const recentProjects = catchAsync(async (req, res) => {
  const rows = await dashboardService.getRecentProjects(req, RECENT_LIST_LIMIT);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data: rows.map(projectToDto) });
});

const recentUrgentTickets = catchAsync(async (req, res) => {
  const rows = await dashboardService.getRecentUrgentTickets(req, RECENT_LIST_LIMIT);
  res.status(httpStatus.OK).send({ message: res.__('dashboard_loaded'), data: rows.map(ticketToDto) });
});

module.exports = {
  me,
  leaveChart,
  ticketChart,
  expenseChart,
  projectChart,
  userChart,
  organizationChart,
  timesheetChart,
  summary,
  todos,
  recentProjects,
  recentUrgentTickets,
};
