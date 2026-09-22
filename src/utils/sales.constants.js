/**
 * Sales & CRM domain constants — the single source of truth on the backend for the
 * Sales module. Mirrors the structure of the other domain constant modules
 * (ats.constants.js, leave.constants.js, project.constants.js).
 *
 * Core resources:
 *   SalesConfig     — one row per org: feature flags, defaults, lead sources, custom-field
 *                     definitions. Makes the module configurable per tenant WITHOUT schema
 *                     changes (JSONB config, like Job.interview_rounds / screening_criteria).
 *   SalesPipeline   — a per-org, named, ordered set of stages (JSONB). A Deal.stage_key
 *                     points into its pipeline's stages. Same pattern as interview_rounds.
 *   Lead            — an early/unqualified prospect. Stands alone (B2C) or converts into
 *                     Account + Contact (+ Deal) for B2B.
 *   Account         — a company you sell to (B2B). Container for contacts + deals.
 *   Contact         — a person, optionally attached to an Account (nullable for B2C).
 *   Deal            — a revenue opportunity on a pipeline stage. Multi-currency per deal.
 *   SalesActivity   — a logged interaction (call/meeting/email/note/task/follow-up),
 *                     polymorphically attached to a lead/account/contact/deal.
 *   SalesTeam       — a named team + members (project-member join pattern).
 *
 * Every meaningful Deal/Lead transition writes an immutable event row (DealEvent /
 * LeadEvent) so the sales history is fully auditable — mirrors ApplicationEvent.
 */

// ── Currencies (multi-currency per deal; product-owner decision §0.7) ───────────
/**
 * Supported currencies. Kept in sync with the ATS JOB_CURRENCIES set so money fields
 * across the platform share one vocabulary. Each Deal/Quote carries its OWN currency;
 * SalesConfig.defaults.currency is only the pre-selected default when creating a record.
 */
const SALES_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'SGD']);
const DEFAULT_CURRENCY = 'USD';

// ── Lead lifecycle ──────────────────────────────────────────────────────────────
/**
 * System lifecycle of a lead (org-specific sub-statuses, if any, live in custom_fields):
 *   NEW          — freshly captured (initial state).
 *   CONTACTED    — first outreach made.
 *   QUALIFIED    — meets qualification criteria; worth pursuing.
 *   UNQUALIFIED  — not a fit (terminal, negative).
 *   CONVERTED    — turned into an Account/Contact/Deal (terminal, positive).
 */
const LEAD_STATUSES = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  UNQUALIFIED: 'unqualified',
  CONVERTED: 'converted',
});

/** Terminal lead statuses — no further transition allowed. */
const LEAD_TERMINAL_STATUSES = Object.freeze([
  LEAD_STATUSES.UNQUALIFIED,
  LEAD_STATUSES.CONVERTED,
]);

/**
 * Default lead sources seeded into SalesConfig.lead_sources. Orgs can edit/add/remove
 * these (product-owner decision §11.2). Stored as [{ key, label, active }].
 */
const DEFAULT_LEAD_SOURCES = Object.freeze([
  { key: 'website', label: 'Website', active: true },
  { key: 'referral', label: 'Referral', active: true },
  { key: 'cold_call', label: 'Cold Call', active: true },
  { key: 'linkedin', label: 'LinkedIn', active: true },
  { key: 'event', label: 'Event', active: true },
  { key: 'walk_in', label: 'Walk-in', active: true },
  { key: 'other', label: 'Other', active: true },
]);

// ── Deal lifecycle ────────────────────────────────────────────────────────────
/**
 * Derived status of a deal, computed from its current pipeline stage's is_won/is_lost
 * flags and stored on the row for cheap filtering (the service writes it on every stage
 * move):
 *   OPEN  — in progress (stage is neither won nor lost).
 *   WON   — landed on the pipeline's terminal is_won stage.
 *   LOST  — landed on the pipeline's terminal is_lost stage.
 */
const DEAL_STATUSES = Object.freeze({
  OPEN: 'open',
  WON: 'won',
  LOST: 'lost',
});

// ── Pipelines & stages (per-org, JSONB; the interview_rounds pattern) ───────────
/**
 * A pipeline carries an ORDERED list of stages in `stages` (JSONB), each:
 *   { key, name, order, probability, is_won, is_lost }
 * A pipeline must have exactly one is_won and one is_lost terminal stage. A deal's
 * stage_key points at one of these. `probability` (0–100) seeds the deal's probability
 * when it enters the stage (overridable per deal). These are the DEFAULT stages
 * pre-filled for a new org; sales managers can add/remove/rename.
 */
const DEFAULT_PIPELINE_STAGES = Object.freeze([
  { key: 'qualification', name: 'Qualification', order: 1, probability: 10, is_won: false, is_lost: false },
  { key: 'needs_analysis', name: 'Needs Analysis', order: 2, probability: 25, is_won: false, is_lost: false },
  { key: 'proposal', name: 'Proposal', order: 3, probability: 50, is_won: false, is_lost: false },
  { key: 'negotiation', name: 'Negotiation', order: 4, probability: 75, is_won: false, is_lost: false },
  { key: 'won', name: 'Won', order: 5, probability: 100, is_won: true, is_lost: false },
  { key: 'lost', name: 'Lost', order: 6, probability: 0, is_won: false, is_lost: true },
]);

const DEFAULT_PIPELINE_NAME = 'Default Pipeline';
const PIPELINE_MAX_STAGES = 20;
const PIPELINE_STAGE_KEY_MAX_LENGTH = 60;
const PIPELINE_STAGE_NAME_MAX_LENGTH = 120;

// ── Activities ──────────────────────────────────────────────────────────────────
/** What kind of interaction an activity records. */
const ACTIVITY_TYPES = Object.freeze({
  CALL: 'call',
  MEETING: 'meeting',
  EMAIL: 'email',
  NOTE: 'note',
  TASK: 'task',
  FOLLOW_UP: 'follow_up',
});

/**
 * Status for task-type activities (task / follow_up). Non-task activities (call/meeting/
 * email/note) are logged as historical records and default to COMPLETED.
 */
const ACTIVITY_STATUSES = Object.freeze({
  OPEN: 'open',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

/** Activity types that behave like tasks (have a due date + open/complete lifecycle). */
const ACTIVITY_TASK_TYPES = Object.freeze([ACTIVITY_TYPES.TASK, ACTIVITY_TYPES.FOLLOW_UP]);

/**
 * The record an activity is attached to (polymorphic owner). Mirrors the attachments
 * table's owner_type approach — resolved at the service layer, not by a hard FK.
 */
const RELATED_TYPES = Object.freeze({
  LEAD: 'lead',
  ACCOUNT: 'account',
  CONTACT: 'contact',
  DEAL: 'deal',
});

// ── Audit event types ─────────────────────────────────────────────────────────
/** Event types written to the immutable deal_events audit trail. */
const DEAL_EVENT_TYPES = Object.freeze({
  CREATED: 'created',
  STAGE_CHANGED: 'stage_changed',
  STATUS_CHANGED: 'status_changed',
  OWNER_CHANGED: 'owner_changed',
  AMOUNT_CHANGED: 'amount_changed',
  WON: 'won',
  LOST: 'lost',
  NOTE_ADDED: 'note_added',
});

/** Event types written to the immutable lead_events audit trail. */
const LEAD_EVENT_TYPES = Object.freeze({
  CREATED: 'created',
  STATUS_CHANGED: 'status_changed',
  OWNER_CHANGED: 'owner_changed',
  CONVERTED: 'converted',
  NOTE_ADDED: 'note_added',
});

// ── Sales teams ─────────────────────────────────────────────────────────────────
/** A member's role WITHIN a sales team (independent of org-level RBAC role). */
const TEAM_MEMBER_ROLES = Object.freeze({
  MANAGER: 'manager',
  MEMBER: 'member',
});

// ── Custom fields (per-org, JSONB definitions in SalesConfig; §12.1) ────────────
/**
 * Field types a sales manager can define for custom fields on any core entity. Values
 * are stored in each row's `custom_fields` JSONB and validated against the org's defs
 * (unknown keys rejected, required enforced, type-checked) — JSONB is never a
 * free-for-all. New types are added here + in the frontend renderer; no schema change.
 */
const CUSTOM_FIELD_TYPES = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  CURRENCY: 'currency',
  DATE: 'date',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  CHECKBOX: 'checkbox',
  EMAIL: 'email',
  PHONE: 'phone',
  URL: 'url',
});

/** Entities that support per-org custom fields. */
const CUSTOM_FIELD_ENTITIES = Object.freeze(['lead', 'account', 'contact', 'deal']);

const CUSTOM_FIELD_MAX_PER_ENTITY = 50;
const CUSTOM_FIELD_KEY_MAX_LENGTH = 60;
const CUSTOM_FIELD_LABEL_MAX_LENGTH = 120;

// ── Feature flags (SalesConfig.features) ────────────────────────────────────────
/**
 * Default feature-flag set for a new org's SalesConfig. Phase-1 core features default
 * ON; Phase-2/4 features default OFF until the org opts in (or an admin enables them).
 * The frontend nav renders a sub-feature only when its flag is ON AND the user holds
 * the matching permission.
 */
const DEFAULT_SALES_FEATURES = Object.freeze({
  // Phase 1 — core CRM
  leads: true,
  accounts: true,
  contacts: true,
  deals: true,
  activities: true,
  teams: true,
  dashboard: true,
  // Phase 2 — sales operations
  products: false,
  quotes: false,
  targets: false,
  commissions: false,
  territories: false,
  forecasting: false,
  // Phase 4 — AI
  ai: false,
});

// ── Field limits (shared by model + validation) ─────────────────────────────────
const LEAD_NAME_MAX_LENGTH = 150;
const LEAD_COMPANY_MAX_LENGTH = 200;
const ACCOUNT_NAME_MAX_LENGTH = 200;
const CONTACT_NAME_MAX_LENGTH = 150;
const DEAL_TITLE_MAX_LENGTH = 200;
const SHORT_TEXT_MAX_LENGTH = 200;
const ACTIVITY_SUBJECT_MAX_LENGTH = 255;
const ACTIVITY_BODY_MAX_LENGTH = 5000;
const EVENT_NOTE_MAX_LENGTH = 2000;
const TEAM_NAME_MAX_LENGTH = 150;

/** Money bounds — DECIMAL(14,2) matches the ATS salary fields; never float. */
const MONEY_MAX = 99999999999.99;

/** Probability bounds for a deal / stage. */
const PROBABILITY_MIN = 0;
const PROBABILITY_MAX = 100;

/** AI lead score bounds (Phase 4; reserved on the leads table now). */
const AI_SCORE_MIN = 0;
const AI_SCORE_MAX = 100;

// ── Sequence-code prefixes (human-friendly identifiers via nextSequenceCode) ─────
const LEAD_CODE_PREFIX = 'LEAD';
const ACCOUNT_CODE_PREFIX = 'ACC';
const DEAL_CODE_PREFIX = 'DEAL';

// ── Attachment owner_types (polymorphic attachments table) ──────────────────────
const SALES_ATTACHMENT_OWNER_TYPES = Object.freeze({
  LEAD: 'sales_lead',
  ACCOUNT: 'sales_account',
  CONTACT: 'sales_contact',
  DEAL: 'sales_deal',
  ACTIVITY: 'sales_activity',
});

module.exports = {
  SALES_CURRENCIES,
  DEFAULT_CURRENCY,
  LEAD_STATUSES,
  LEAD_TERMINAL_STATUSES,
  DEFAULT_LEAD_SOURCES,
  DEAL_STATUSES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_NAME,
  PIPELINE_MAX_STAGES,
  PIPELINE_STAGE_KEY_MAX_LENGTH,
  PIPELINE_STAGE_NAME_MAX_LENGTH,
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_TASK_TYPES,
  RELATED_TYPES,
  DEAL_EVENT_TYPES,
  LEAD_EVENT_TYPES,
  TEAM_MEMBER_ROLES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_MAX_PER_ENTITY,
  CUSTOM_FIELD_KEY_MAX_LENGTH,
  CUSTOM_FIELD_LABEL_MAX_LENGTH,
  DEFAULT_SALES_FEATURES,
  LEAD_NAME_MAX_LENGTH,
  LEAD_COMPANY_MAX_LENGTH,
  ACCOUNT_NAME_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  DEAL_TITLE_MAX_LENGTH,
  SHORT_TEXT_MAX_LENGTH,
  ACTIVITY_SUBJECT_MAX_LENGTH,
  ACTIVITY_BODY_MAX_LENGTH,
  EVENT_NOTE_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  MONEY_MAX,
  PROBABILITY_MIN,
  PROBABILITY_MAX,
  AI_SCORE_MIN,
  AI_SCORE_MAX,
  LEAD_CODE_PREFIX,
  ACCOUNT_CODE_PREFIX,
  DEAL_CODE_PREFIX,
  SALES_ATTACHMENT_OWNER_TYPES,
};
