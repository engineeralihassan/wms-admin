const express = require('express');

const router = express.Router();

const authRoute = require('./auth.route');
const organizationRoute = require('./organization.route');
const userRoute = require('./user.route');
const ticketRoute = require('./ticket.route');
const expenseRoute = require('./expense.route');
const projectRoute = require('./project.route');
const leaveRoute = require('./leave.route');
const timesheetRoute = require('./timesheet.route');
const dashboardRoute = require('./dashboard.route');
const fileRoute = require('./files.route');
const jobRoute = require('./job.route');
const applicationRoute = require('./application.route');
const interviewRoute = require('./interview.route');
const careersRoute = require('./careers.route');
const chatRoute = require('./chat.route');
const salesRoute = require('./sales.route');
const docsRoute = require('./docs.route');

const devRoutes = [
  {
    path: '/docs',
    route: docsRoute,
  },
];

const routes = [
  { path: '/auth', route: authRoute },
  { path: '/organizations', route: organizationRoute },
  { path: '/users', route: userRoute },
  { path: '/tickets', route: ticketRoute },
  { path: '/expenses', route: expenseRoute },
  { path: '/projects', route: projectRoute },
  { path: '/leaves', route: leaveRoute },
  { path: '/timesheets', route: timesheetRoute },
  { path: '/dashboard', route: dashboardRoute },
  { path: '/files', route: fileRoute },
  // ATS: recruiter-facing jobs + applications, and the PUBLIC careers surface.
  { path: '/jobs', route: jobRoute },
  { path: '/applications', route: applicationRoute },
  { path: '/interviews', route: interviewRoute },
  { path: '/careers', route: careersRoute },
  { path: '/chat', route: chatRoute },
  // Sales & CRM (leads, and — as Phase 1 lands — accounts/contacts/deals/etc.).
  { path: '/sales', route: salesRoute },
];

routes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (process.env.NODE_ENV === 'DEVELOPMENT') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

module.exports = router;
