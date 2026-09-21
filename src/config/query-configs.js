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

module.exports = {
  USER_QUERY_CONFIG,
  ORGANIZATION_QUERY_CONFIG,
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
};
