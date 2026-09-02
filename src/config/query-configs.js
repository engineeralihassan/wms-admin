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

module.exports = {
  USER_QUERY_CONFIG,
  ORGANIZATION_QUERY_CONFIG,
  TICKET_QUERY_CONFIG,
  EXPENSE_QUERY_CONFIG,
  PROJECT_QUERY_CONFIG,
  LEAVE_QUERY_CONFIG,
  LEAVE_BALANCE_QUERY_CONFIG,
};
