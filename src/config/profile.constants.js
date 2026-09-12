/**
 * Profile domain constants — the single source of truth for the self-service
 * "User Profile" page (visa/work-authorization, bank details, and the section
 * locking model).
 *
 * DESIGN NOTES
 *  - VISA_STATUSES is a canonical enum so the FE dropdown and the BE validation
 *    never drift. Each entry declares whether an expiration date and a work
 *    authorization document are REQUIRED, which drives the conditional UI
 *    (e.g. a US Citizen hides the expiration field; an H1B requires it).
 *  - PROFILE_SECTIONS enumerates the lockable, structured sections of the profile
 *    (Option A locking). A section becomes LOCKED once an admin verifies it; a
 *    locked section can no longer be edited by the user (self-service writes are
 *    rejected server-side) until an admin unlocks it — the user requests that
 *    change via a ticket. Documents carry their own lock via UserDocument.status
 *    === 'verified'; these section markers cover the STRUCTURED data (bank + work
 *    authorization metadata) that isn't a single document row.
 */

/** Canonical work-authorization / visa statuses. */
const VISA_STATUSES = Object.freeze({
  US_CITIZEN: 'us_citizen',
  GREEN_CARD: 'green_card',
  GC_EAD: 'gc_ead',
  H1B: 'h1b',
  H4_EAD: 'h4_ead',
  L1: 'l1',
  L2_EAD: 'l2_ead',
  OPT_F1: 'opt_f1',
  CPT_F1: 'cpt_f1',
  TN: 'tn',
  OTHER: 'other',
});

/**
 * Metadata per visa status:
 *  - label:            human-friendly name for the dropdown.
 *  - requiresExpiry:   whether an expiration date is expected/required.
 *  - requiresDocument: whether a work-authorization document is expected/required.
 *
 * US Citizen and Green Card Holder are permanent statuses, so they hide/skip the
 * expiration date. Everything else is time-bound and needs an expiry + document.
 */
const WORK_AUTH = 'work_authorization';

const VISA_STATUS_META = Object.freeze({
  [VISA_STATUSES.US_CITIZEN]: {
    label: 'U.S. Citizen',
    requiresExpiry: false,
    requiresDocument: false,
    documents: [],
  },
  [VISA_STATUSES.GREEN_CARD]: {
    label: 'Green Card Holder',
    requiresExpiry: false,
    requiresDocument: false,
    documents: [],
  },
  [VISA_STATUSES.GC_EAD]: {
    label: 'Green Card EAD',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.H1B]: {
    label: 'H-1B',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.H4_EAD]: {
    label: 'H-4 EAD',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.L1]: {
    label: 'L-1',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.L2_EAD]: {
    label: 'L-2 EAD',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.OPT_F1]: {
    label: 'F-1 OPT',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.CPT_F1]: {
    label: 'F-1 CPT',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.TN]: {
    label: 'TN',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
  [VISA_STATUSES.OTHER]: {
    label: 'Other',
    requiresExpiry: true,
    requiresDocument: true,
    documents: [WORK_AUTH],
  },
});

/** Document slots that always appear in the Work Authorization section. */
const WORK_AUTH_BASE_DOCUMENTS = Object.freeze(['w4_form', 'state_issued_id']);

/** Ordered doc slots for a visa status: status-specific first, then the base docs. */
const workAuthDocumentTypes = (status) => {
  const meta = VISA_STATUS_META[status];
  const statusDocs = meta && Array.isArray(meta.documents) ? meta.documents : [];
  return [...statusDocs, ...WORK_AUTH_BASE_DOCUMENTS];
};

const VISA_STATUS_KEYS = Object.freeze(Object.values(VISA_STATUSES));

/** Does the given visa status require an expiration date? Unknown -> treated as time-bound. */
const visaRequiresExpiry = (status) => {
  const meta = VISA_STATUS_META[status];
  return meta ? meta.requiresExpiry : true;
};

/**
 * Lockable structured profile sections (Option A locking).
 * Documents lock individually via UserDocument.status; these cover the structured
 * JSONB blocks that aren't a single document row.
 */
const PROFILE_SECTIONS = Object.freeze({
  BANK_DETAILS: 'bank_details',
  WORK_AUTHORIZATION: 'work_authorization',
  EMERGENCY_CONTACT: 'emergency_contact',
});

const PROFILE_SECTION_KEYS = Object.freeze(Object.values(PROFILE_SECTIONS));

/** Supported bank account types. */
const BANK_ACCOUNT_TYPES = Object.freeze(['checking', 'savings']);

/**
 * Mask a sensitive numeric string (account/routing), showing only the last 4 digits.
 * Returns null for empty input. Used in the self-service DTO so raw values are never
 * echoed back to the browser once stored.
 */
const maskNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value);
  if (str.length <= 4) return `••••${str}`;
  return `••••${str.slice(-4)}`;
};

module.exports = {
  VISA_STATUSES,
  VISA_STATUS_META,
  VISA_STATUS_KEYS,
  visaRequiresExpiry,
  WORK_AUTH_BASE_DOCUMENTS,
  workAuthDocumentTypes,
  PROFILE_SECTIONS,
  PROFILE_SECTION_KEYS,
  BANK_ACCOUNT_TYPES,
  maskNumber,
};
