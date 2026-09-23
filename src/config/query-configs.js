/**
 * Per-resource query configuration = the allow-lists that make search/sort/filter safe.
 *
 * Only columns listed here can be sorted, searched, or filtered by clients. Adding a
 * new sortable/searchable field is a one-line, reviewable change. Never put a column
 * here that isn't backed by an index if it'll be sorted/searched at scale.
 *
 * Field names must be actual DB column names (underscored), since they go into
 * ORDER BY / WHERE.
 */
const USER_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'first_name', 'last_name', 'email', 'status'],
  searchable: ['first_name', 'last_name', 'email'],
  filterable: ['status', 'role_id'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const ORGANIZATION_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'name', 'slug', 'is_active'],
  searchable: ['name', 'slug'],
  filterable: ['is_active'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const TICKET_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'ticket_number', 'priority', 'status'],
  searchable: ['subject', 'ticket_number'],
  filterable: ['status', 'priority'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const EXPENSE_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'expense_number',
    'expense_date',
    'amount',
    'status',
    'category',
    'submitted_at',
  ],
  searchable: ['title', 'expense_number'],
  filterable: ['status', 'category', 'currency'],
  rangeFilterable: ['created_at', 'expense_date'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const PROJECT_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'project_code',
    'name',
    'status',
    'priority',
    'start_date',
    'end_date',
  ],
  searchable: ['name', 'project_code'],
  filterable: ['status', 'priority'],
  rangeFilterable: ['created_at', 'start_date', 'end_date'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const LEAVE_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'leave_number',
    'start_date',
    'end_date',
    'status',
    'total_days',
    'submitted_at',
  ],
  searchable: ['leave_number', 'reason'],
  filterable: ['status', 'leave_type_id', 'day_portion'],
  rangeFilterable: ['created_at', 'start_date', 'end_date'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const LEAVE_BALANCE_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'period_year', 'allocated', 'used'],
  searchable: [],
  filterable: ['leave_type_id', 'period_year', 'user_id'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const TIMESHEET_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'timesheet_number',
    'week_start_date',
    'week_end_date',
    'due_date',
    'total_hours',
    'status',
    'submitted_at',
  ],
  searchable: ['timesheet_number'],
  // project_id is resolved from the project's public uuid in the service (ids are
  // never exposed), then applied as part of the security scope — same pattern the
  // leave service uses for leave_type. status is a direct enum match.
  filterable: ['status', 'project_id'],
  rangeFilterable: ['created_at', 'week_start_date', 'due_date'],
  defaultSort: 'week_start_date',
  maxLimit: 100,
  mode: 'offset',
});

const JOB_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'job_code',
    'title',
    'status',
    'employment_type',
    'work_mode',
    'published_at',
  ],
  searchable: ['title', 'job_code', 'department', 'location'],
  filterable: ['status', 'employment_type', 'work_mode', 'department'],
  rangeFilterable: ['created_at', 'published_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const APPLICATION_QUERY_CONFIG = Object.freeze({
  sortable: [
    'created_at',
    'updated_at',
    'application_number',
    'candidate_name',
    'status',
    'rating',
    'submitted_at',
  ],
  searchable: ['candidate_name', 'candidate_email', 'application_number'],
  filterable: ['status', 'stage_key', 'source', 'job_id'],
  rangeFilterable: ['created_at', 'submitted_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const INTERVIEW_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'interview_number', 'scheduled_start', 'status'],
  searchable: ['interview_number', 'title'],
  filterable: ['status', 'mode', 'provider', 'stage_key'],
  rangeFilterable: ['created_at', 'scheduled_start'],
  defaultSort: 'scheduled_start',
  maxLimit: 100,
  mode: 'offset',
});

const CONVERSATION_QUERY_CONFIG = Object.freeze({
  sortable: ['last_message_at', 'created_at'],
  searchable: [],
  filterable: [],
  rangeFilterable: ['created_at'],
  defaultSort: 'last_message_at',
  maxLimit: 50,
  mode: 'offset',
});

const CHAT_MESSAGE_QUERY_CONFIG = Object.freeze({
  sortable: ['id', 'created_at'],
  searchable: [],
  filterable: [],
  rangeFilterable: ['created_at'],
  defaultSort: 'id',
  maxLimit: 50,
  mode: 'keyset',
});

// ── Sales & CRM ──────────────────────────────────────────────────────────────
// Allow-lists mirroring APPLICATION_QUERY_CONFIG. Owner/tenant scope is applied
// separately by buildSalesScope; these only govern client-controllable sort/search/
// filter. owner_id is filterable so a manager can filter by rep.

const LEAD_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'lead_number', 'first_name', 'status', 'estimated_value', 'ai_score'],
  searchable: ['first_name', 'last_name', 'email', 'company_name', 'lead_number'],
  filterable: ['status', 'source', 'owner_id', 'currency'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const ACCOUNT_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'account_number', 'name', 'annual_revenue'],
  searchable: ['name', 'account_number', 'email'],
  filterable: ['owner_id', 'industry', 'account_type'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const CONTACT_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'first_name', 'last_name'],
  searchable: ['first_name', 'last_name', 'email'],
  // account_id resolved from the account's public uuid in the service (ids never exposed).
  filterable: ['owner_id', 'account_id', 'is_primary'],
  rangeFilterable: ['created_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const DEAL_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'deal_number', 'title', 'amount', 'probability', 'expected_close_date', 'status'],
  searchable: ['title', 'deal_number'],
  // pipeline_id / account_id resolved from public uuids in the service.
  filterable: ['status', 'stage_key', 'pipeline_id', 'owner_id', 'account_id', 'currency'],
  rangeFilterable: ['created_at', 'expected_close_date'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

const SALES_ACTIVITY_QUERY_CONFIG = Object.freeze({
  sortable: ['created_at', 'updated_at', 'due_at', 'completed_at'],
  searchable: ['subject'],
  filterable: ['activity_type', 'status', 'owner_id', 'related_type', 'related_id'],
  rangeFilterable: ['created_at', 'due_at'],
  defaultSort: 'created_at',
  maxLimit: 100,
  mode: 'offset',
});

// Opportunities (Sales discovery). Owner-scoped for reps at the service layer; this
// config only governs safe sort/search/filter. status/type/is_remote are filterable so
// users can quickly narrow to e.g. remote, saved opportunities.
const OPPORTUNITY_QUERY_CONFIG = Object.freeze({
  sortable: ['discovered_at', 'posted_at', 'last_seen_at', 'title', 'company_name', 'status', 'salary_max'],
  searchable: ['title', 'company_name', 'location', 'publisher'],
  filterable: ['status', 'opportunity_type', 'is_remote', 'source'],
  rangeFilterable: ['discovered_at', 'posted_at'],
  defaultSort: 'discovered_at',
  maxLimit: 100,
  mode: 'offset',
});

module.exports = {
  USER_QUERY_CONFIG,
  ORGANIZATION_QUERY_CONFIG,
  OPPORTUNITY_QUERY_CONFIG,
  TICKET_QUERY_CONFIG,
  EXPENSE_QUERY_CONFIG,
  PROJECT_QUERY_CONFIG,
  LEAVE_QUERY_CONFIG,
  LEAVE_BALANCE_QUERY_CONFIG,
  TIMESHEET_QUERY_CONFIG,
  JOB_QUERY_CONFIG,
  APPLICATION_QUERY_CONFIG,
  INTERVIEW_QUERY_CONFIG,
  CONVERSATION_QUERY_CONFIG,
  CHAT_MESSAGE_QUERY_CONFIG,
  LEAD_QUERY_CONFIG,
  ACCOUNT_QUERY_CONFIG,
  CONTACT_QUERY_CONFIG,
  DEAL_QUERY_CONFIG,
  SALES_ACTIVITY_QUERY_CONFIG,
};
