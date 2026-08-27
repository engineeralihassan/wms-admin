const { Op } = require('sequelize');
const { parseQueryOptions, encodeCursor, mergeAnd } = require('./query-options');

/**
 * Reusable pagination engine. One function every list endpoint can use.
 *
 * Two strategies:
 *
 *  OFFSET (default) — findAndCountAll with LIMIT/OFFSET. Returns a total count and
 *  page metadata, so the UI can show "page 3 of 27". Best for admin tables. Note the
 *  well-known trade-off: very deep pages (large OFFSET) get slower because Postgres
 *  scans and discards the skipped rows.
 *
 *  KEYSET (cursor) — "seek" pagination using WHERE (sortCol, id) > (lastValue, lastId).
 *  Stays O(limit) at ANY depth because it seeks on an indexed column instead of
 *  counting from the top. Best for infinite scroll / very large datasets. No total.
 *
 * The caller passes its own security scope (tenant/ownership where-clause); this
 * helper merges it with the parsed search/filter clause so isolation is preserved.
 *
 * @param {Model}  model        Sequelize model
 * @param {object} rawQuery     req.query
 * @param {object} config       resource query config (sortable/searchable/etc.)
 * @param {object} extra        { scopeWhere, attributes, include }
 * @returns {Promise<{ data, meta }>}
 */
const paginate = async (model, rawQuery, config, extra = {}) => {
  const opts = parseQueryOptions(rawQuery, config);
  const scopeWhere = extra.scopeWhere || {};
  const baseWhere = mergeAnd(scopeWhere, opts.where);

  const findOptions = {
    where: baseWhere,
    order: opts.order,
    limit: opts.limit,
  };
  if (extra.attributes) findOptions.attributes = extra.attributes;
  if (extra.include) findOptions.include = extra.include;

  if (opts.mode === 'keyset') {
    return keysetPage(model, findOptions, opts);
  }
  return offsetPage(model, findOptions, opts);
};

/** Offset strategy: total count + rows for the requested page. */
const offsetPage = async (model, findOptions, opts) => {
  const { rows, count } = await model.findAndCountAll({
    ...findOptions,
    offset: opts.offset,
    // distinct keeps the count correct when includes cause row multiplication.
    distinct: true,
  });

  const total = Array.isArray(count) ? count.length : count;
  const totalPages = Math.max(1, Math.ceil(total / opts.limit));

  return {
    data: rows,
    meta: {
      strategy: 'offset',
      page: opts.page,
      limit: opts.limit,
      total,
      totalPages,
      hasNext: opts.page < totalPages,
      hasPrev: opts.page > 1,
      sortBy: opts.sortColumn,
      sortDir: opts.sortDir.toLowerCase(),
      search: opts.searchTerm || undefined,
    },
  };
};

/**
 * Keyset strategy: seek past the cursor using a compound comparison on
 * (sortColumn, id) so ties on the sort column are broken deterministically by id.
 * Fetches limit+1 to know whether there's a next page without a COUNT.
 */
const keysetPage = async (model, findOptions, opts) => {
  const dir = opts.sortDir === 'ASC' ? Op.gt : Op.lt;
  const where = { ...findOptions.where };

  if (opts.cursor) {
    const { v, id } = opts.cursor;
    // (sortCol, id) > (v, id): either sortCol strictly past v, or equal-and-id-past.
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { [opts.sortColumn]: { [dir]: v } },
          { [opts.sortColumn]: v, id: { [dir]: id } },
        ],
      },
    ];
  }

  const rows = await model.findAll({
    ...findOptions,
    where,
    // Stable, deterministic ordering: sort column then id as tiebreaker.
    order: [[opts.sortColumn, opts.sortDir], ['id', opts.sortDir]],
    limit: opts.limit + 1,
  });

  const hasNext = rows.length > opts.limit;
  const pageRows = hasNext ? rows.slice(0, opts.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasNext && last
      ? encodeCursor({ v: last.get(opts.sortColumn), id: last.get('id') })
      : null;

  return {
    data: pageRows,
    meta: {
      strategy: 'keyset',
      limit: opts.limit,
      hasNext,
      nextCursor,
      sortBy: opts.sortColumn,
      sortDir: opts.sortDir.toLowerCase(),
      search: opts.searchTerm || undefined,
    },
  };
};

module.exports = { paginate };
