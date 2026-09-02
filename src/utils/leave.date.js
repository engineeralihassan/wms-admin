const { LEAVE_WEEKEND_DAYS, LEAVE_DAY_PORTION_VALUE } = require('./leave.constants');

/**
 * Leave date helpers, isolated so a future public-holiday calendar and working-week
 * configuration can plug in here without changing any callers in the service.
 */

/** Parse a YYYY-MM-DD (or Date) into a UTC-midnight Date, ignoring time/zone drift. */
const toUtcDate = (value) => {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Today at UTC midnight (the reference for the "no past dates" rule). */
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** Format a Date as YYYY-MM-DD (UTC). */
const formatDate = (date) => toUtcDate(date).toISOString().slice(0, 10);

/** Is the given date a non-working (weekend) day? */
const isWeekend = (date) => LEAVE_WEEKEND_DAYS.includes(toUtcDate(date).getUTCDay());

/** Iterate each calendar day in [start, end] inclusive. */
const eachDay = (start, end) => {
  const days = [];
  const cur = toUtcDate(start);
  const last = toUtcDate(end);
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
};

/** Count working (non-weekend) days in [start, end] inclusive. */
const countBusinessDays = (start, end) =>
  eachDay(start, end).reduce((n, d) => (isWeekend(d) ? n : n + 1), 0);

/**
 * Total leave days a request consumes: business days in range × the day-portion
 * fraction. For a single-day half-day request this yields 0.5.
 */
const computeTotalDays = (start, end, dayPortion) => {
  const businessDays = countBusinessDays(start, end);
  const fraction = LEAVE_DAY_PORTION_VALUE[dayPortion] ?? 1;
  // Half-day only makes sense on a single day; for multi-day ranges we count full days.
  const single = formatDate(start) === formatDate(end);
  const days = single ? businessDays * fraction : businessDays;
  return Math.round(days * 100) / 100;
};

/** Do two inclusive date ranges overlap on any day? */
const rangesOverlap = (aStart, aEnd, bStart, bEnd) =>
  toUtcDate(aStart) <= toUtcDate(bEnd) && toUtcDate(bStart) <= toUtcDate(aEnd);

module.exports = {
  toUtcDate,
  todayUtc,
  formatDate,
  isWeekend,
  eachDay,
  countBusinessDays,
  computeTotalDays,
  rangesOverlap,
};
