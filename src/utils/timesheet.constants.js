/**
 * Timesheet domain constants — the single source of truth on the backend for the
 * Weekly Timesheet module. Mirrors the structure of expense.constants / leave.constants.
 *
 * MODEL OF THE MODULE
 * -------------------
 * A Timesheet is ONE user's week of work against ONE project (the long-lived container
 * is the existing Project; a 1-year project simply spawns ~52 weekly timesheets per
 * member). Each timesheet owns 7 TimesheetEntry rows (one per calendar day, Sun..Sat).
 *
 * WEEKLY CADENCE (as specified by the business)
 *   - The work week runs SUNDAY -> SATURDAY.
 *   - The user may fill/submit any time up to Saturday evening (the due date).
 *   - If not submitted, up to 2 reminder emails are queued (near/at the due date).
 *   - A GRACE margin of 2 days is allowed after the week ends: the user can still
 *     submit late until the following TUESDAY (the lock date).
 *   - After the lock date the timesheet is LOCKED: the owner can do nothing except
 *     request the admin. On lock the system notifies the org's approver(s) and opens a
 *     Ticket on the owner's behalf so the request to backfill hours is tracked.
 *   - An approver/admin can always edit (correct) a timesheet, even after lock; a
 *     correction to a submitted/approved sheet notifies the owner ("changed for
 *     correctness").
 */

/**
 * Lifecycle of a weekly timesheet.
 *
 *   UNSUBMITTED — the auto-generated default. The owner is still filling daily hours
 *                 (this covers the UI's "Unsubmitted" state; a partially-filled sheet
 *                 is simply an unsubmitted sheet with entries).
 *   SUBMITTED   — the owner submitted the week for approval; awaits an approver.
 *   APPROVED    — an approver accepted the week. Terminal for the happy path. This is
 *                 the status a future payroll module reads from.
 *   REJECTED    — an approver sent it back (with a note); the owner may edit & resubmit.
 *   LOCKED      — the lock date passed while still unsubmitted. The owner is frozen out;
 *                 only an approver/admin may add or correct logs from here.
 *
 * Allowed transitions (enforced in the service):
 *   UNSUBMITTED -> SUBMITTED              (owner submits, on/before lock date)
 *   UNSUBMITTED -> LOCKED                 (lock job, when due window elapsed)
 *   SUBMITTED   -> UNSUBMITTED            (owner withdraws, before review + lock)
 *   SUBMITTED   -> APPROVED | REJECTED    (approver decides)
 *   REJECTED    -> SUBMITTED              (owner revises & resubmits, before lock)
 *   LOCKED      -> SUBMITTED | APPROVED   (approver backfills/accepts on owner's behalf)
 */
const TIMESHEET_STATUSES = Object.freeze({
  UNSUBMITTED: 'unsubmitted',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  LOCKED: 'locked',
});

/** Statuses in which the OWNER may still edit daily entries (before the lock date). */
const OWNER_EDITABLE_STATUSES = Object.freeze([
  TIMESHEET_STATUSES.UNSUBMITTED,
  TIMESHEET_STATUSES.REJECTED,
]);

/** Statuses that count as "not yet decided" for reminder/lock sweeps. */
const OPEN_STATUSES = Object.freeze([
  TIMESHEET_STATUSES.UNSUBMITTED,
  TIMESHEET_STATUSES.REJECTED,
]);

/** Approver decision verbs (mirrors leave/expense review). */
const TIMESHEET_DECISIONS = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
});

/**
 * Week configuration. WEEK_START_DAY follows JS getUTCDay(): 0=Sunday .. 6=Saturday.
 * The business runs Sunday->Saturday, so the week starts on 0.
 */
const WEEK_START_DAY = 0; // Sunday
const DAYS_IN_WEEK = 7;

/**
 * Cadence offsets, all measured in days from the week's START date (Sunday = day 0):
 *   DUE_OFFSET_DAYS  = 6 -> Saturday (end of week) is the due date.
 *   LOCK_OFFSET_DAYS = 9 -> the following Tuesday is the hard lock (Sat + 2 grace days
 *                           = Mon end; Tuesday is the first fully-locked day, matching
 *                           "till Tuesday he can still submit; once Tuesday passes it's
 *                           locked"). The lock sweep runs when now >= lock_date.
 *
 * Reminders are queued relative to the due date (see REMINDER_OFFSETS_DAYS).
 */
const DUE_OFFSET_DAYS = 6; // Saturday
const GRACE_DAYS = 2; // extra days to submit late (Sun+Mon after the week)
const LOCK_OFFSET_DAYS = DUE_OFFSET_DAYS + GRACE_DAYS + 1; // 9 -> Tuesday

/**
 * When to send reminder emails to owners who haven't submitted, as day-offsets from
 * the week start. 5 = Friday (first nudge), 6 = Saturday (final nudge before the week
 * ends). The generator only queues a reminder once per (timesheet, kind) — see the
 * reminders_sent JSONB marker on the model.
 */
const REMINDER_OFFSETS = Object.freeze([
  { key: 'due_soon', offsetDays: 5 }, // Friday
  { key: 'due_today', offsetDays: 6 }, // Saturday
]);

/** Per-day hour guard rails. */
const HOURS_MIN = 0;
const HOURS_MAX = 24;
/** A sane ceiling on a full week so a fat-fingered entry can't record 1000h. */
const WEEK_HOURS_MAX = 24 * DAYS_IN_WEEK; // 168

/** owner_type used to key timesheet files in the polymorphic attachments table. */
const TIMESHEET_OWNER_TYPE = 'timesheet';

const TIMESHEET_ATTACHMENT_MAX_FILES = 5;

/**
 * Reason codes stamped on a TimesheetJob (the durable queue row) so one worker can run
 * all three periodic passes. Mirrors ResumeScreeningJob.reason.
 */
const TIMESHEET_JOB_TYPES = Object.freeze({
  GENERATE: 'generate', // create the upcoming week's sheets for valid members
  REMIND: 'remind', // queue reminder emails for unsubmitted sheets
  LOCK: 'lock', // lock overdue unsubmitted sheets + notify admin + open ticket
});

const TIMESHEET_SORT_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'timesheet_number',
  'week_start_date',
  'week_end_date',
  'due_date',
  'total_hours',
  'status',
  'submitted_at',
]);

module.exports = {
  TIMESHEET_STATUSES,
  OWNER_EDITABLE_STATUSES,
  OPEN_STATUSES,
  TIMESHEET_DECISIONS,
  WEEK_START_DAY,
  DAYS_IN_WEEK,
  DUE_OFFSET_DAYS,
  GRACE_DAYS,
  LOCK_OFFSET_DAYS,
  REMINDER_OFFSETS,
  HOURS_MIN,
  HOURS_MAX,
  WEEK_HOURS_MAX,
  TIMESHEET_OWNER_TYPE,
  TIMESHEET_ATTACHMENT_MAX_FILES,
  TIMESHEET_JOB_TYPES,
  TIMESHEET_SORT_FIELDS,
};
