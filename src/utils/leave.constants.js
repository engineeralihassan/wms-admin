/**
 * Leave Management domain constants — the single source of truth on the backend for
 * the Leave / Time Off module. Mirrors the structure of expense.constants.js.
 */

/**
 * Lifecycle of a leave request:
 *
 *   DRAFT      — applicant is still editing; not visible to approvers as actionable.
 *   SUBMITTED  — applicant submitted for approval; awaits an approver's decision.
 *                While SUBMITTED, paid days are held in the balance's `pending` bucket.
 *   APPROVED   — an approver (org admin) approved it. Paid days move pending -> used.
 *   REJECTED   — an approver rejected it (with a reason). Held pending days released.
 *   WITHDRAWN  — the applicant withdrew a still-pending request. Held days released.
 *   CANCELLED  — an approver cancelled an already-approved request. Used days released.
 *
 * Allowed transitions (enforced in the service):
 *   DRAFT      -> SUBMITTED             (applicant submits)
 *   SUBMITTED  -> APPROVED | REJECTED   (approver decides)
 *   SUBMITTED  -> WITHDRAWN             (applicant withdraws while pending)
 *   REJECTED   -> DRAFT | SUBMITTED     (applicant may revise & resubmit)
 *   APPROVED   -> CANCELLED             (approver cancels, releasing used days)
 */
const LEAVE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  CANCELLED: 'cancelled',
});

/**
 * Statuses that "actively occupy" days on a user's calendar. Used for overlap
 * detection and for the timesheet read contract (a day covered by one of these
 * statuses is accounted for by leave).
 */
const LEAVE_ACTIVE_STATUSES = Object.freeze([
  LEAVE_STATUSES.SUBMITTED,
  LEAVE_STATUSES.APPROVED,
]);

/**
 * Portion of a day a leave request covers. v1 only uses FULL; FIRST_HALF/SECOND_HALF
 * are reserved so the future half-day / timesheet integration needs no migration.
 */
const LEAVE_DAY_PORTIONS = Object.freeze({
  FULL: 'full',
  FIRST_HALF: 'first_half',
  SECOND_HALF: 'second_half',
});

/** Fractional day value each portion consumes from the balance. */
const LEAVE_DAY_PORTION_VALUE = Object.freeze({
  [LEAVE_DAY_PORTIONS.FULL]: 1,
  [LEAVE_DAY_PORTIONS.FIRST_HALF]: 0.5,
  [LEAVE_DAY_PORTIONS.SECOND_HALF]: 0.5,
});

/**
 * The approver's decision on a submitted request.
 */
const LEAVE_DECISIONS = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
});

/**
 * Ledger entry types — every movement on a leave balance writes one, so balances are
 * fully reconstructable and disputes are traceable.
 *
 *   ALLOCATION — admin grants days to a balance (positive).
 *   HOLD       — a request is submitted; days moved into `pending`.
 *   CONSUME    — a request is approved; days moved pending -> used.
 *   RELEASE    — a request is rejected/withdrawn/cancelled; held or used days freed.
 */
const LEAVE_LEDGER_ENTRY_TYPES = Object.freeze({
  ALLOCATION: 'allocation',
  HOLD: 'hold',
  CONSUME: 'consume',
  RELEASE: 'release',
});

/**
 * Default leave types seeded per organization. `is_paid` drives the paid/unpaid
 * behavior; `requires_balance` decides whether submission checks available balance
 * (unpaid leave never checks a balance).
 */
const DEFAULT_LEAVE_TYPES = Object.freeze([
  { key: 'annual', name: 'Annual Leave', is_paid: true, requires_balance: true, color: '#2563eb' },
  { key: 'sick', name: 'Sick Leave', is_paid: true, requires_balance: true, color: '#dc2626' },
  { key: 'casual', name: 'Casual Leave', is_paid: true, requires_balance: true, color: '#16a34a' },
  { key: 'unpaid', name: 'Unpaid Leave', is_paid: false, requires_balance: false, color: '#6b7280' },
]);

/**
 * Days of the week treated as non-working when computing `total_days` (0 = Sunday,
 * 6 = Saturday). A future public-holiday calendar plugs into the same helper without
 * changing callers.
 */
const LEAVE_WEEKEND_DAYS = Object.freeze([0, 6]);

const LEAVE_REASON_MAX_LENGTH = 2000;
const LEAVE_REJECTION_REASON_MAX_LENGTH = 1000;

const LEAVE_SORT_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'leave_number',
  'start_date',
  'end_date',
  'status',
  'total_days',
]);

/**
 * Attachment rules (metadata only for now — we persist the file name, no bytes).
 * Same allow-list contract as tickets/expenses; when object storage lands, the same
 * limits apply to real uploads. Leave attachments are optional (e.g. a medical cert).
 */
const LEAVE_ATTACHMENT_MAX_FILES = 3;
const LEAVE_ATTACHMENT_MAX_NAME_LENGTH = 255;

/** Allowed file extensions (lowercase, with dot). */
const LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.xls',
  '.xlsx',
  '.csv',
  '.doc',
  '.docx',
]);

module.exports = {
  LEAVE_STATUSES,
  LEAVE_ACTIVE_STATUSES,
  LEAVE_DAY_PORTIONS,
  LEAVE_DAY_PORTION_VALUE,
  LEAVE_DECISIONS,
  LEAVE_LEDGER_ENTRY_TYPES,
  DEFAULT_LEAVE_TYPES,
  LEAVE_WEEKEND_DAYS,
  LEAVE_REASON_MAX_LENGTH,
  LEAVE_REJECTION_REASON_MAX_LENGTH,
  LEAVE_SORT_FIELDS,
  LEAVE_ATTACHMENT_MAX_FILES,
  LEAVE_ATTACHMENT_MAX_NAME_LENGTH,
  LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS,
};
