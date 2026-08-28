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

module.exports = { USER_QUERY_CONFIG, ORGANIZATION_QUERY_CONFIG };
