const express = require('express');

const router = express.Router();

const authRoute = require('./auth.route');
const organizationRoute = require('./organization.route');
const userRoute = require('./user.route');
const ticketRoute = require('./ticket.route');
const expenseRoute = require('./expense.route');
const projectRoute = require('./project.route');
const leaveRoute = require('./leave.route');
const dashboardRoute = require('./dashboard.route');
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
  { path: '/dashboard', route: dashboardRoute },
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
