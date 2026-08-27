const { Op } = require('sequelize');

/**
 * Parses raw request query params into a SAFE, normalized query descriptor.
 *
 * Security model: nothing from the client reaches a SQL fragment without passing an
 * allow-list. Sort columns and search columns are validated against the per-resource
 * config; anything not on the list is ignored. This is what makes ORDER BY / WHERE
 * injection impossible even though the client controls the field names.
 *
 * Supported params:
 *   page, limit                 -> offset pagination
 *   cursor, limit               -> keyset pagination (when mode='keyset')
 *   sortBy, sortDir (asc|desc)   -> ordering (sortBy must be allow-listed)
 *   search                      -> case-insensitive match across searchable columns
 *   filters.*                   -> exact-match on allow-listed filterable columns
 *
 * @param {object} rawQuery  req.query
 * @param {object} config    { sortable[], searchable[], filterable[], defaultSort, maxLimit, mode }
 */
const DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
  sortDir: 'DESC',
  mode: 'offset', // 'offset' | 'keyset'
};

const parseQueryOptions = (rawQuery = {}, config = {}) => {
  const sortable = config.sortable || [];
  const searchable = config.searchable || [];
  const filterable = config.filterable || [];
  const maxLimit = config.maxLimit || DEFAULTS.maxLimit;
  const mode = config.mode || DEFAULTS.mode;

  // ---- Pagination ----
  const limit = clampInt(rawQuery.limit, DEFAULTS.limit, 1, maxLimit);
  const page = clampInt(rawQuery.page, DEFAULTS.page, 1, Number.MAX_SAFE_INTEGER);
  const offset = (page - 1) * limit;

  // ---- Sorting (allow-listed) ----
  const requestedSort = String(rawQuery.sortBy || '');
  const sortColumn = sortable.includes(requestedSort)
    ? requestedSort
    : config.defaultSort || sortable[0] || 'created_at';
  const sortDir = String(rawQuery.sortDir || DEFAULTS.sortDir).toUpperCase() === 'ASC'
    ? 'ASC'
    : 'DESC';

  // ---- Search (allow-listed columns, case-insensitive) ----
  const searchTerm = typeof rawQuery.search === 'string' ? rawQuery.search.trim() : '';
  const searchWhere = buildSearchWhere(searchTerm, searchable);

  // ---- Filters (exact match, allow-listed) ----
  const filterWhere = buildFilterWhere(rawQuery.filters, filterable);

  // ---- Keyset cursor (opaque base64 of the last row's sort key + id) ----
  const cursor = mode === 'keyset' ? decodeCursor(rawQuery.cursor) : null;

  return {
    mode,
    page,
    limit,
    offset,
    sortColumn,
    sortDir,
    searchTerm,
    searchWhere,
    filterWhere,
    cursor,
    // A combined where fragment the caller merges with its own scope.
    where: mergeAnd(searchWhere, filterWhere),
    order: [[sortColumn, sortDir]],
  };
};

/** Case-insensitive OR across searchable columns using ILIKE. */
const buildSearchWhere = (term, searchable) => {
  if (!term || searchable.length === 0) return null;
  const like = { [Op.iLike]: `%${escapeLike(term)}%` };
  return { [Op.or]: searchable.map((col) => ({ [col]: like })) };
};

/** Exact-match filters, only for allow-listed columns. */
const buildFilterWhere = (filters, filterable) => {
  if (!filters || typeof filters !== 'object' || filterable.length === 0) return null;
  const clauses = {};
  for (const col of filterable) {
    if (filters[col] !== undefined && filters[col] !== '') {
      clauses[col] = filters[col];
    }
  }
  return Object.keys(clauses).length ? clauses : null;
};

const mergeAnd = (...fragments) => {
  const present = fragments.filter(Boolean);
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { [Op.and]: present };
};

/** Escape LIKE/ILIKE wildcards so user input is treated literally. */
const escapeLike = (value) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/** Cursor is base64(JSON({ v: <sortValue>, id: <id> })) — opaque to clients. */
const encodeCursor = (payload) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

const decodeCursor = (cursor) => {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

module.exports = { parseQueryOptions, encodeCursor, decodeCursor, mergeAnd };
