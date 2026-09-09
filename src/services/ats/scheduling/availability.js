const {
  INTERVIEW_LIMITS,
  INTERVIEW_DEFAULT_WORKING_HOURS,
} = require('../../../utils/ats.constants');

/**
 * Slot availability + conflict detection for interview scheduling.
 *
 * This is the provider-agnostic core that powers the "pick a time" experience of a
 * real ATS. Given a date range, a duration, a set of interviewers and their existing
 * bookings, it produces the list of bookable start times, and can answer "does this
 * exact window collide with an existing booking?" at commit time.
 *
 * TIMEZONES WITHOUT A LIBRARY: the project only ships plain `moment` (no tz data), so
 * we resolve an IANA zone's UTC offset for a given instant using the built-in
 * `Intl.DateTimeFormat` (ships with Node). All stored/compared times are absolute UTC
 * instants (Date); the timezone only governs how working-hours ("09:00") map to those
 * instants. This is correct across DST because the offset is computed per-instant.
 */

// ── Timezone helpers (built-in Intl, no external dependency) ──────────────────────

/**
 * The UTC offset (in minutes) that IANA `timeZone` has at the given absolute instant.
 * Positive means ahead of UTC (e.g. Asia/Kolkata = +330).
 */
const offsetMinutesAt = (timeZone, instant) => {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(instant).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    // The wall-clock time the zone shows for this instant, read back as if it were UTC.
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - instant.getTime()) / 60000);
  } catch (err) {
    // Unknown/invalid zone -> treat as UTC.
    return 0;
  }
};

/** Is the IANA timezone id resolvable on this runtime? */
const isValidTimezone = (timeZone) => {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Convert a wall-clock time (Y/M/D H:M) IN `timeZone` to the absolute UTC instant.
 * Handles DST by resolving the offset at the candidate instant and correcting once.
 */
const zonedWallTimeToInstant = (timeZone, y, mo, d, h, mi) => {
  // First guess: treat the wall time as if UTC, then subtract the zone offset.
  const guess = new Date(Date.UTC(y, mo, d, h, mi, 0));
  const offset = offsetMinutesAt(timeZone, guess);
  const corrected = new Date(guess.getTime() - offset * 60000);
  // Re-check the offset at the corrected instant (covers the DST edge) and fix if moved.
  const offset2 = offsetMinutesAt(timeZone, corrected);
  if (offset2 !== offset) {
    return new Date(guess.getTime() - offset2 * 60000);
  }
  return corrected;
};

/** The wall-clock Y/M/D and weekday a zone shows for an absolute instant. */
const wallPartsAt = (timeZone, instant) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(instant).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
  };
};

const parseHm = (hm) => {
  const [h, m] = String(hm).split(':').map((n) => Number(n));
  return { h: h || 0, m: m || 0 };
};

// ── Slot generation ───────────────────────────────────────────────────────────

/**
 * Two windows [aStart,aEnd) and [bStart,bEnd) overlap (touching edges do NOT count).
 * All args are epoch milliseconds.
 */
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Generate bookable slots.
 *
 * @param {Object} p
 * @param {Date}   p.rangeStart      window start (absolute)
 * @param {Date}   p.rangeEnd        window end (absolute)
 * @param {number} p.durationMinutes interview length
 * @param {string} p.timezone        IANA zone the working hours are expressed in
 * @param {Array}  p.busy            [{ start:Date, end:Date }] existing bookings to avoid
 * @param {Object} [p.workingHours]  { days:number[], start:'HH:mm', end:'HH:mm' }
 * @param {number} [p.granularityMinutes]
 * @param {number} [p.bufferMinutes] gap enforced around each busy block
 * @param {Date}   [p.now]           earliest allowed start (defaults to current time)
 * @returns {Array<{ start: string, end: string }>} ISO instants, capped.
 */
const generateSlots = ({
  rangeStart,
  rangeEnd,
  durationMinutes,
  timezone,
  busy = [],
  workingHours = INTERVIEW_DEFAULT_WORKING_HOURS,
  granularityMinutes = INTERVIEW_LIMITS.DEFAULT_SLOT_GRANULARITY_MINUTES,
  bufferMinutes = INTERVIEW_LIMITS.DEFAULT_BUFFER_MINUTES,
  now = new Date(),
}) => {
  const slots = [];
  const durMs = durationMinutes * 60000;
  const bufMs = bufferMinutes * 60000;
  const stepMs = granularityMinutes * 60000;
  const days = workingHours.days || INTERVIEW_DEFAULT_WORKING_HOURS.days;
  const { h: startH, m: startM } = parseHm(workingHours.start || INTERVIEW_DEFAULT_WORKING_HOURS.start);
  const { h: endH, m: endM } = parseHm(workingHours.end || INTERVIEW_DEFAULT_WORKING_HOURS.end);

  // Pre-expand busy windows by the buffer on both sides.
  const blocked = busy.map((b) => ({
    start: b.start.getTime() - bufMs,
    end: b.end.getTime() + bufMs,
  }));

  // Walk day by day in the target timezone.
  const oneDayMs = 24 * 60 * 60000;
  let cursor = new Date(rangeStart.getTime());
  let safety = 0;
  while (cursor.getTime() <= rangeEnd.getTime() && safety < 400) {
    safety += 1;
    const parts = wallPartsAt(timezone, cursor);

    if (days.includes(parts.weekday)) {
      const dayStart = zonedWallTimeToInstant(timezone, parts.year, parts.month, parts.day, startH, startM);
      const dayEnd = zonedWallTimeToInstant(timezone, parts.year, parts.month, parts.day, endH, endM);

      for (let t = dayStart.getTime(); t + durMs <= dayEnd.getTime(); t += stepMs) {
        const slotStart = t;
        const slotEnd = t + durMs;
        if (slotStart < now.getTime()) continue;
        if (slotStart < rangeStart.getTime() || slotEnd > rangeEnd.getTime()) continue;
        const collides = blocked.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (collides) continue;
        slots.push({
          start: new Date(slotStart).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
        if (slots.length >= INTERVIEW_LIMITS.MAX_SLOTS_RETURNED) return slots;
      }
    }

    // Advance to the next calendar day at ~noon to avoid DST edge skips.
    const nextParts = wallPartsAt(timezone, new Date(cursor.getTime() + oneDayMs));
    cursor = zonedWallTimeToInstant(timezone, nextParts.year, nextParts.month, nextParts.day, 12, 0);
  }

  return slots;
};

/**
 * Does [start,end) collide with any busy window (buffer applied)? Used at commit time
 * to guarantee no double-booking even if the client's slot list was stale.
 */
const hasConflict = ({ start, end, busy = [], bufferMinutes = INTERVIEW_LIMITS.DEFAULT_BUFFER_MINUTES }) => {
  const bufMs = bufferMinutes * 60000;
  const s = start.getTime();
  const e = end.getTime();
  return busy.some((b) => overlaps(s, e, b.start.getTime() - bufMs, b.end.getTime() + bufMs));
};

module.exports = {
  offsetMinutesAt,
  isValidTimezone,
  zonedWallTimeToInstant,
  wallPartsAt,
  overlaps,
  generateSlots,
  hasConflict,
};
