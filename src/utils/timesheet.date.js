const {
  WEEK_START_DAY,
  DAYS_IN_WEEK,
  DUE_OFFSET_DAYS,
  LOCK_OFFSET_DAYS,
} = require('./timesheet.constants');

/**
 * Timesheet week-math helpers, isolated (like leave.date.js) so a future per-org
 * working-week configuration can plug in here without touching the service. All math
 * is done at UTC midnight so DATEONLY columns and comparisons never drift by timezone.
 */

/** Parse a YYYY-MM-DD (or Date) into a UTC-midnight Date. */
const toUtcDate = (value) => {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Today at UTC midnight. */
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** Format a Date as YYYY-MM-DD (UTC). */
const formatDate = (date) => toUtcDate(date).toISOString().slice(0, 10);

/** Add n days to a date (returns a new UTC-midnight Date). */
const addDays = (date, n) => {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

/**
 * Snap any date back to the START of its work week (Sunday, per WEEK_START_DAY).
 * e.g. a Wednesday returns the preceding Sunday.
 */
const weekStartOf = (date) => {
  const d = toUtcDate(date);
  const diff = (d.getUTCDay() - WEEK_START_DAY + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return addDays(d, -diff);
};

/** The 7 calendar days of the week that contains `date`, as UTC-midnight Dates. */
const weekDays = (date) => {
  const start = weekStartOf(date);
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(start, i));
};

/**
 * Compute the full window for the week containing `date`:
 *   { weekStart, weekEnd, dueDate, lockDate } — all YYYY-MM-DD strings.
 *
 *   weekStart = Sunday, weekEnd = Saturday (weekStart + 6),
 *   dueDate   = weekStart + DUE_OFFSET_DAYS  (Saturday),
 *   lockDate  = weekStart + LOCK_OFFSET_DAYS (the following Tuesday).
 */
const weekWindow = (date) => {
  const start = weekStartOf(date);
  return {
    weekStart: formatDate(start),
    weekEnd: formatDate(addDays(start, DAYS_IN_WEEK - 1)),
    dueDate: formatDate(addDays(start, DUE_OFFSET_DAYS)),
    lockDate: formatDate(addDays(start, LOCK_OFFSET_DAYS)),
  };
};

/** The window for the week that CONTAINS today (UTC). */
const currentWeekWindow = () => weekWindow(todayUtc());

/** The window for the week that starts one week before today's week start. */
const previousWeekWindow = () => weekWindow(addDays(weekStartOf(todayUtc()), -DAYS_IN_WEEK));

module.exports = {
  toUtcDate,
  todayUtc,
  formatDate,
  addDays,
  weekStartOf,
  weekDays,
  weekWindow,
  currentWeekWindow,
  previousWeekWindow,
};
