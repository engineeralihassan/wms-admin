const { Op } = require('sequelize');
const { Deal, Lead, SalesActivity, sequelize } = require('../../models');
const {
  DEAL_STATUSES,
  LEAD_STATUSES,
  ACTIVITY_STATUSES,
  ACTIVITY_TASK_TYPES,
} = require('../../utils/sales.constants');
const {
  buildDealScope,
  buildLeadScope,
  isSalesManager,
} = require('./sales.shared');

/**
 * sales-dashboard.service — role-aware KPIs.
 *
 * Scope is the whole story: a rep's numbers come from buildDealScope / buildLeadScope
 * (own records), while a manager/admin sees the org-wide figures through the SAME helpers
 * (their manage_all overlay widens the scope). No separate "manager query" — the overlay
 * does it, so the two views can never drift.
 *
 * Returns plain numbers + small groupings the frontend can render as cards/charts. Money
 * sums are returned as numbers (DECIMAL summed in SQL, cast in JS).
 */

const num = (v) => (v == null ? 0 : Number(v));

/** Start of the current month (server local) — the default "this period" boundary. */
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const getDashboard = async (req) => {
  const dealScope = buildDealScope(req);
  const leadScope = buildLeadScope(req);
  const periodStart = startOfMonth();

  // ── Deal KPIs ──────────────────────────────────────────────────────────────
  // Open pipeline: count + total amount + weighted forecast (sum amount*prob/100).
  const openAgg = await Deal.findOne({
    where: { ...dealScope, status: DEAL_STATUSES.OPEN },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'value'],
      [
        sequelize.literal('COALESCE(SUM(amount * probability / 100.0), 0)'),
        'weighted',
      ],
    ],
    raw: true,
  });

  // Won / lost this period (by closed_at within the current month).
  const wonAgg = await Deal.findOne({
    where: { ...dealScope, status: DEAL_STATUSES.WON, closed_at: { [Op.gte]: periodStart } },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'value'],
    ],
    raw: true,
  });
  const lostCount = await Deal.count({
    where: { ...dealScope, status: DEAL_STATUSES.LOST, closed_at: { [Op.gte]: periodStart } },
  });

  // Open deals grouped by stage (for a pipeline funnel widget).
  const byStageRows = await Deal.findAll({
    where: { ...dealScope, status: DEAL_STATUSES.OPEN },
    attributes: [
      'stage_key',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'value'],
    ],
    group: ['stage_key'],
    raw: true,
  });

  // ── Lead KPIs ────────────────────────────────────────────────────────────
  const leadsByStatusRows = await Lead.findAll({
    where: { ...leadScope },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });
  const leadsByStatus = leadsByStatusRows.reduce((acc, r) => {
    acc[r.status] = num(r.count);
    return acc;
  }, {});
  const newLeads = leadsByStatus[LEAD_STATUSES.NEW] || 0;

  // ── My tasks (always personal — the caller's own open/overdue) ─────────────
  const myOpenTasks = await SalesActivity.count({
    where: {
      ...req.tenantWhere,
      owner_id: req.auth.userId,
      activity_type: { [Op.in]: ACTIVITY_TASK_TYPES },
      status: ACTIVITY_STATUSES.OPEN,
    },
  });
  const myOverdueTasks = await SalesActivity.count({
    where: {
      ...req.tenantWhere,
      owner_id: req.auth.userId,
      activity_type: { [Op.in]: ACTIVITY_TASK_TYPES },
      status: ACTIVITY_STATUSES.OPEN,
      due_at: { [Op.lt]: new Date() },
    },
  });

  return {
    scope: isSalesManager(req.auth) ? 'organization' : 'own',
    period_start: periodStart,
    deals: {
      open_count: num(openAgg && openAgg.count),
      open_value: num(openAgg && openAgg.value),
      weighted_forecast: Math.round(num(openAgg && openAgg.weighted) * 100) / 100,
      won_this_period_count: num(wonAgg && wonAgg.count),
      won_this_period_value: num(wonAgg && wonAgg.value),
      lost_this_period_count: lostCount,
      by_stage: byStageRows.map((r) => ({
        stage_key: r.stage_key,
        count: num(r.count),
        value: num(r.value),
      })),
    },
    leads: {
      total: Object.values(leadsByStatus).reduce((a, b) => a + b, 0),
      new: newLeads,
      by_status: leadsByStatus,
    },
    tasks: {
      my_open: myOpenTasks,
      my_overdue: myOverdueTasks,
    },
  };
};

module.exports = { getDashboard };
