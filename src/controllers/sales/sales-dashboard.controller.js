const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { salesDashboardService } = require('../../services');

/** GET /sales/dashboard — role-aware KPIs (rep = own, manager/admin = org). */
const getDashboard = catchAsync(async (req, res) => {
  const data = await salesDashboardService.getDashboard(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

module.exports = { getDashboard };
