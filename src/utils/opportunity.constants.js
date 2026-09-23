/**
 * Opportunity domain constants — the single source of truth for the Sales
 * "Opportunity discovery" feature (mirrors the structure of sales.constants.js /
 * ats.constants.js).
 *
 * An Opportunity is a normalized, org-scoped record discovered from an external source
 * (currently the OpenWeb Ninja JSearch API). Users review discovered opportunities and
 * convert the promising ones into Sales Leads.
 */

/**
 * Lifecycle status of a discovered opportunity (org + owner scoped like sales records):
 *   NEW        — freshly discovered, not yet actioned (initial state).
 *   SAVED      — a user flagged it as worth keeping / pursuing.
 *   REJECTED   — a user dismissed it (terminal, negative).
 *   CONVERTED  — turned into a Sales Lead (terminal, positive; converted_lead_id set).
 */
const OPPORTUNITY_STATUSES = Object.freeze({
  NEW: 'new',
  SAVED: 'saved',
  REJECTED: 'rejected',
  CONVERTED: 'converted',
});

/** Terminal statuses — status transitions stop here. */
const OPPORTUNITY_TERMINAL_STATUSES = Object.freeze([
  OPPORTUNITY_STATUSES.REJECTED,
  OPPORTUNITY_STATUSES.CONVERTED,
]);

/** Statuses a user may set directly via the status endpoint (convert has its own route). */
const OPPORTUNITY_USER_SETTABLE_STATUSES = Object.freeze([
  OPPORTUNITY_STATUSES.NEW,
  OPPORTUNITY_STATUSES.SAVED,
  OPPORTUNITY_STATUSES.REJECTED,
]);

/**
 * Opportunity types (extensible). The JSearch source produces JOB today; the enum is
 * declared broadly so future sources (RFPs, freelance projects, service requests) slot
 * in without a schema change.
 */
const OPPORTUNITY_TYPES = Object.freeze({
  JOB: 'job',
  FREELANCE_PROJECT: 'freelance_project',
  SERVICE_REQUEST: 'service_request',
  RFP: 'rfp',
  RFQ: 'rfq',
  CONTRACT: 'contract',
  CONSULTING_REQUEST: 'consulting_request',
  OTHER: 'other',
});

/** Source keys an opportunity can originate from (matches config.opportunity sourceKey). */
const OPPORTUNITY_SOURCES = Object.freeze({
  JSEARCH: 'jsearch',
});

/** Field length caps applied to UNTRUSTED external content before persisting. */
const OPPORTUNITY_TITLE_MAX = 300;
const OPPORTUNITY_DESCRIPTION_MAX = 20000;
const OPPORTUNITY_SHORT_TEXT_MAX = 255;
const OPPORTUNITY_URL_MAX = 2000;

/** Search input caps (validation + defensive). */
const OPPORTUNITY_QUERY_MIN = 2;
const OPPORTUNITY_QUERY_MAX = 300;

/** Allowed JSearch `date_posted` values (forwarded verbatim). */
const DATE_POSTED_VALUES = Object.freeze(['all', 'today', '3days', 'week', 'month']);

/** Allowed JSearch employment types (comma-joined when forwarded). */
const EMPLOYMENT_TYPES = Object.freeze(['FULLTIME', 'CONTRACTOR', 'PARTTIME', 'INTERN']);

module.exports = {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TERMINAL_STATUSES,
  OPPORTUNITY_USER_SETTABLE_STATUSES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_TITLE_MAX,
  OPPORTUNITY_DESCRIPTION_MAX,
  OPPORTUNITY_SHORT_TEXT_MAX,
  OPPORTUNITY_URL_MAX,
  OPPORTUNITY_QUERY_MIN,
  OPPORTUNITY_QUERY_MAX,
  DATE_POSTED_VALUES,
  EMPLOYMENT_TYPES,
};
