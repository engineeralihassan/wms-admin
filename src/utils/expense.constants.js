/**
 * Expense domain constants — the single source of truth on the backend for the
 * Expense Management module. Mirrors the structure of ticket.constants.js.
 */

/**
 * Lifecycle of an expense claim:
 *
 *   DRAFT      — owner is still editing; not visible to reviewers as actionable.
 *   SUBMITTED  — owner submitted for approval; awaits an org reviewer's decision.
 *   APPROVED   — a reviewer (org admin) approved it. Terminal for the happy path.
 *   REJECTED   — a reviewer rejected it (with a reason). Terminal unless reopened.
 *
 * Allowed transitions (enforced in the service):
 *   DRAFT     -> SUBMITTED            (owner submits)
 *   SUBMITTED -> APPROVED | REJECTED  (reviewer decides)
 *   REJECTED  -> DRAFT | SUBMITTED    (owner may revise & resubmit)
 */
const EXPENSE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/**
 * Which statuses an owner may put an expense into via the "save" path.
 * (Reviewers use the dedicated review endpoint for approve/reject.)
 */
const OWNER_SETTABLE_STATUSES = Object.freeze([
  EXPENSE_STATUSES.DRAFT,
  EXPENSE_STATUSES.SUBMITTED,
]);

/**
 * Expense categories. Kept as an enum for data integrity and cheap filtering.
 * Extend this list (and the DB enum via the seeder) as the business grows; using a
 * dedicated categories table can come later without changing the API shape.
 */
const EXPENSE_CATEGORIES = Object.freeze({
  TRAVEL: 'travel',
  MEALS: 'meals',
  ACCOMMODATION: 'accommodation',
  SUPPLIES: 'supplies',
  EQUIPMENT: 'equipment',
  SOFTWARE: 'software',
  TRAINING: 'training',
  OTHER: 'other',
});

/** Supported ISO-4217 currency codes. Amounts are stored in the given currency. */
const EXPENSE_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD']);

const EXPENSE_DEFAULT_CURRENCY = 'USD';

/** Money guard rails: non-negative, within a sane maximum, 2 decimal places. */
const EXPENSE_AMOUNT_MIN = 0.01;
const EXPENSE_AMOUNT_MAX = 100000000; // 100M in the chosen currency

const EXPENSE_SORT_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'expense_number',
  'expense_date',
  'amount',
  'status',
  'category',
  'submitted_at',
]);

/**
 * Attachment rules (metadata only for now — we persist the file name, no bytes).
 * The UI advertises "up to 5 attachments, max 5 MB each"; we allow-list here so the
 * same limits apply when real object storage (S3 presigned URLs) is wired in.
 */
const EXPENSE_ATTACHMENT_MAX_FILES = 5;
const EXPENSE_ATTACHMENT_MAX_NAME_LENGTH = 255;

/** Allowed file extensions (lowercase, with dot). */
const EXPENSE_ATTACHMENT_ALLOWED_EXTENSIONS = Object.freeze([
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
  EXPENSE_STATUSES,
  OWNER_SETTABLE_STATUSES,
  EXPENSE_CATEGORIES,
  EXPENSE_CURRENCIES,
  EXPENSE_DEFAULT_CURRENCY,
  EXPENSE_AMOUNT_MIN,
  EXPENSE_AMOUNT_MAX,
  EXPENSE_SORT_FIELDS,
  EXPENSE_ATTACHMENT_MAX_FILES,
  EXPENSE_ATTACHMENT_MAX_NAME_LENGTH,
  EXPENSE_ATTACHMENT_ALLOWED_EXTENSIONS,
};
