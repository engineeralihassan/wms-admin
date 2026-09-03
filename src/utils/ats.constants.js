/**
 * ATS (Applicant Tracking System) domain constants — the single source of truth on
 * the backend for the Jobs / Applications module. Mirrors the structure of the other
 * domain constant modules (leave.constants.js, project.constants.js).
 *
 * Two related resources:
 *   Job              — a tenant-scoped opening a recruiter posts. Defines the public
 *                      job description + an ordered interview pipeline (rounds).
 *   JobApplication   — one candidate's submission against a Job. Made through the
 *                      PUBLIC careers page (no auth), then progressed by the recruiter
 *                      through the job's pipeline to a terminal outcome.
 *
 * Every status/stage transition also writes an immutable ApplicationEvent row so the
 * hiring history is fully auditable (mirrors the leave balance ledger).
 */

// ── Job lifecycle ─────────────────────────────────────────────────────────────

/**
 * Lifecycle of a job opening:
 *
 *   DRAFT   — recruiter is still editing; NOT reachable via the public link.
 *   OPEN    — published; the public careers link renders the description + apply form.
 *   CLOSED  — recruiter/admin stopped accepting applications (paused/cancelled).
 *             The public link shows a "no longer accepting applications" message.
 *   FILLED  — the position was filled. Public link shows a "position filled" message.
 *
 * Allowed transitions (enforced in the service):
 *   DRAFT  -> OPEN                 (publish)
 *   OPEN   -> CLOSED | FILLED      (close / mark filled)
 *   CLOSED -> OPEN                 (re-open)
 *   FILLED -> OPEN                 (re-open, e.g. a new headcount)
 */
const JOB_STATUSES = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  CLOSED: 'closed',
  FILLED: 'filled',
});

/** Statuses whose public page still accepts applications. */
const JOB_PUBLIC_OPEN_STATUSES = Object.freeze([JOB_STATUSES.OPEN]);

/**
 * Why a public link is not accepting applications — surfaced to the careers page so it
 * can show the right friendly message. Only DRAFT/CLOSED/FILLED reach the public view;
 * DRAFT is treated as "not found" (never published) to avoid leaking unpublished jobs.
 */
const JOB_CLOSED_REASONS = Object.freeze({
  CLOSED: 'closed',
  FILLED: 'filled',
});

/** Employment type of the opening. */
const JOB_EMPLOYMENT_TYPES = Object.freeze({
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  CONTRACT: 'contract',
  INTERNSHIP: 'internship',
  TEMPORARY: 'temporary',
  FREELANCE: 'freelance',
});

/** Work arrangement. */
const JOB_WORK_MODES = Object.freeze({
  ONSITE: 'onsite',
  REMOTE: 'remote',
  HYBRID: 'hybrid',
});

/** Currencies accepted for the salary range (kept in sync with other money fields). */
const JOB_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'SGD']);

/** Salary period the min/max range is quoted against. */
const JOB_SALARY_PERIODS = Object.freeze({
  YEARLY: 'yearly',
  MONTHLY: 'monthly',
  HOURLY: 'hourly',
});

// ── Interview pipeline (per-job, recruiter-defined) ─────────────────────────────

/**
 * A job carries an ORDERED list of interview rounds in `interview_rounds` (JSONB), each:
 *   { key: string, name: string, order: number }
 * The recruiter defines these at creation ("how many rounds and their names", e.g.
 * Screening -> Technical -> CEO -> HR). An application's `stage_key` points at the
 * round it currently sits in while its `status` is INTERVIEWING.
 *
 * These are the DEFAULT rounds pre-filled in the UI; the recruiter can add/remove/rename.
 */
const DEFAULT_INTERVIEW_ROUNDS = Object.freeze([
  { key: 'screening', name: 'Screening', order: 1 },
  { key: 'technical', name: 'Technical Interview', order: 2 },
  { key: 'managerial', name: 'Managerial Round', order: 3 },
  { key: 'hr', name: 'HR Round', order: 4 },
]);

const JOB_MAX_INTERVIEW_ROUNDS = 12;
const INTERVIEW_ROUND_KEY_MAX_LENGTH = 60;
const INTERVIEW_ROUND_NAME_MAX_LENGTH = 120;

// ── Application lifecycle ───────────────────────────────────────────────────────

/**
 * Lifecycle of a candidate application. The recruiter who owns the job (or an org
 * admin) moves it through these:
 *
 *   NEW          — freshly submitted via the public careers page (initial state).
 *   IN_REVIEW    — recruiter is reviewing the CV / profile.
 *   SHORTLISTED  — passed initial screening; candidate to be interviewed.
 *   INTERVIEWING — actively in the interview pipeline; `stage_key` says which round.
 *   SELECTED     — cleared all rounds; selected (offer stage).
 *   HIRED        — offer accepted / onboarded (terminal, positive).
 *   REJECTED     — declined at any point (terminal, negative). `decision_reason` set.
 *   ON_HOLD      — parked for later; can be resumed.
 *
 * Allowed transitions are enforced in the service (see APPLICATION_TRANSITIONS).
 */
const APPLICATION_STATUSES = Object.freeze({
  NEW: 'new',
  IN_REVIEW: 'in_review',
  SHORTLISTED: 'shortlisted',
  INTERVIEWING: 'interviewing',
  SELECTED: 'selected',
  HIRED: 'hired',
  REJECTED: 'rejected',
  ON_HOLD: 'on_hold',
});

/** Terminal statuses — no further transition allowed except HIRED can't move at all. */
const APPLICATION_TERMINAL_STATUSES = Object.freeze([
  APPLICATION_STATUSES.HIRED,
  APPLICATION_STATUSES.REJECTED,
]);

/**
 * Allowed status transitions (from -> [to]). REJECTED and ON_HOLD are reachable from
 * any non-terminal status, so they're merged in by the service. HIRED is fully terminal.
 */
const APPLICATION_TRANSITIONS = Object.freeze({
  [APPLICATION_STATUSES.NEW]: [
    APPLICATION_STATUSES.IN_REVIEW,
    APPLICATION_STATUSES.SHORTLISTED,
  ],
  [APPLICATION_STATUSES.IN_REVIEW]: [
    APPLICATION_STATUSES.SHORTLISTED,
    APPLICATION_STATUSES.NEW,
  ],
  [APPLICATION_STATUSES.SHORTLISTED]: [APPLICATION_STATUSES.INTERVIEWING],
  [APPLICATION_STATUSES.INTERVIEWING]: [APPLICATION_STATUSES.SELECTED],
  [APPLICATION_STATUSES.SELECTED]: [APPLICATION_STATUSES.HIRED],
  // ON_HOLD can resume back into review.
  [APPLICATION_STATUSES.ON_HOLD]: [
    APPLICATION_STATUSES.IN_REVIEW,
    APPLICATION_STATUSES.SHORTLISTED,
    APPLICATION_STATUSES.INTERVIEWING,
  ],
  [APPLICATION_STATUSES.REJECTED]: [],
  [APPLICATION_STATUSES.HIRED]: [],
});

/**
 * Statuses REJECTED / ON_HOLD can be applied from (i.e. any non-terminal status).
 * Used by the service to permit "reject anytime" / "hold anytime".
 */
const APPLICATION_INTERRUPTIBLE_STATUSES = Object.freeze([
  APPLICATION_STATUSES.NEW,
  APPLICATION_STATUSES.IN_REVIEW,
  APPLICATION_STATUSES.SHORTLISTED,
  APPLICATION_STATUSES.INTERVIEWING,
  APPLICATION_STATUSES.SELECTED,
  APPLICATION_STATUSES.ON_HOLD,
]);

/** Where the application came from (for sourcing analytics). */
const APPLICATION_SOURCES = Object.freeze({
  CAREERS_PAGE: 'careers_page',
  REFERRAL: 'referral',
  MANUAL: 'manual',
});

/**
 * Event types written to the immutable application_events audit trail.
 *
 *   CREATED          — application submitted (initial).
 *   STATUS_CHANGED   — status moved (from -> to).
 *   STAGE_CHANGED    — interview round advanced/changed (stage_key from -> to).
 *   NOTE_ADDED       — recruiter left an internal note.
 *   RATING_UPDATED   — recruiter set/updated the candidate rating.
 */
const APPLICATION_EVENT_TYPES = Object.freeze({
  CREATED: 'created',
  STATUS_CHANGED: 'status_changed',
  STAGE_CHANGED: 'stage_changed',
  NOTE_ADDED: 'note_added',
  RATING_UPDATED: 'rating_updated',
  // The screening pipeline finished parsing + scoring this application's resume.
  SCREENED: 'screened',
});

// ── Resume screening ────────────────────────────────────────────────────────────

/**
 * Lifecycle of the async resume screening for an application:
 *   PENDING    — enqueued, not yet processed (or no resume to process yet).
 *   PROCESSING — a worker is extracting text + scoring right now.
 *   DONE       — parsed + scored; screening_score & screening_breakdown are populated.
 *   FAILED     — extraction/scoring failed after retries (e.g. unreadable file).
 *   SKIPPED    — nothing to screen (no supported CV attachment).
 */
const SCREENING_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

/**
 * Optional per-job screening guidance (JSONB `screening_criteria` on the job). Rezmatch
 * already extracts requirements from the job description; these fields let a recruiter
 * emphasize a few must-haves that get appended to the JD text sent to the matcher.
 * All optional — an empty object means "just use the job description".
 *
 *   { must_have_skills: string[], keywords: string[], min_experience: number|null }
 */
const SCREENING_CRITERIA_LIMITS = Object.freeze({
  MAX_MUST_HAVE_SKILLS: 40,
  MAX_KEYWORDS: 60,
  TERM_MAX_LENGTH: 80,
  MAX_EXPERIENCE_YEARS: 60,
});

/** Score band labels (mirrors Rezmatch's weak → excellent bands). */
const SCREENING_BANDS = Object.freeze({
  EXCELLENT: 'excellent',
  STRONG: 'strong',
  GOOD: 'good',
  FAIR: 'fair',
  WEAK: 'weak',
});

/** Map a 0–100 score to a band label (used when the provider omits one). */
const scoreToBand = (score) => {
  if (score == null) return null;
  if (score >= 85) return SCREENING_BANDS.EXCELLENT;
  if (score >= 70) return SCREENING_BANDS.STRONG;
  if (score >= 55) return SCREENING_BANDS.GOOD;
  if (score >= 40) return SCREENING_BANDS.FAIR;
  return SCREENING_BANDS.WEAK;
};

/** Ranking endpoint: default and hard-cap on how many top candidates to return. */
const SCREENING_RANK_DEFAULT_LIMIT = 10;
const SCREENING_RANK_MAX_LIMIT = 100;

// ── Field limits (shared by model + validation) ─────────────────────────────────

const JOB_TITLE_MAX_LENGTH = 200;
const JOB_DESCRIPTION_MAX_LENGTH = 20000;
const JOB_SHORT_TEXT_MAX_LENGTH = 200;
const JOB_MAX_SKILLS = 40;
const JOB_SKILL_MAX_LENGTH = 60;

const APPLICATION_NAME_MAX_LENGTH = 150;
const APPLICATION_COVER_NOTE_MAX_LENGTH = 5000;
const APPLICATION_NOTE_MAX_LENGTH = 2000;
const APPLICATION_DECISION_REASON_MAX_LENGTH = 1000;
const APPLICATION_RATING_MIN = 1;
const APPLICATION_RATING_MAX = 5;

/** Public-token length (bytes of randomness) for the shareable careers link. */
const JOB_PUBLIC_TOKEN_BYTES = 24;

/** Attachment owner_type used to tie uploaded CVs/files to an application. */
const APPLICATION_ATTACHMENT_OWNER_TYPE = 'job_application';

/** Max files a single public application submission may carry (CV + a few docs). */
const APPLICATION_MAX_FILES = 5;

module.exports = {
  JOB_STATUSES,
  JOB_PUBLIC_OPEN_STATUSES,
  JOB_CLOSED_REASONS,
  JOB_EMPLOYMENT_TYPES,
  JOB_WORK_MODES,
  JOB_CURRENCIES,
  JOB_SALARY_PERIODS,
  DEFAULT_INTERVIEW_ROUNDS,
  JOB_MAX_INTERVIEW_ROUNDS,
  INTERVIEW_ROUND_KEY_MAX_LENGTH,
  INTERVIEW_ROUND_NAME_MAX_LENGTH,
  APPLICATION_STATUSES,
  APPLICATION_TERMINAL_STATUSES,
  APPLICATION_TRANSITIONS,
  APPLICATION_INTERRUPTIBLE_STATUSES,
  APPLICATION_SOURCES,
  APPLICATION_EVENT_TYPES,
  JOB_TITLE_MAX_LENGTH,
  JOB_DESCRIPTION_MAX_LENGTH,
  JOB_SHORT_TEXT_MAX_LENGTH,
  JOB_MAX_SKILLS,
  JOB_SKILL_MAX_LENGTH,
  APPLICATION_NAME_MAX_LENGTH,
  APPLICATION_COVER_NOTE_MAX_LENGTH,
  APPLICATION_NOTE_MAX_LENGTH,
  APPLICATION_DECISION_REASON_MAX_LENGTH,
  APPLICATION_RATING_MIN,
  APPLICATION_RATING_MAX,
  JOB_PUBLIC_TOKEN_BYTES,
  APPLICATION_ATTACHMENT_OWNER_TYPE,
  APPLICATION_MAX_FILES,
  SCREENING_STATUSES,
  SCREENING_CRITERIA_LIMITS,
  SCREENING_BANDS,
  scoreToBand,
  SCREENING_RANK_DEFAULT_LIMIT,
  SCREENING_RANK_MAX_LIMIT,
};
