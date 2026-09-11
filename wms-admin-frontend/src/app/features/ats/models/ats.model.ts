/**
 * ATS (Applicant Tracking System) frontend models.
 *
 * These mirror the backend DTOs (uuid-based, no internal ids). The backend is the real
 * authority for validation and the multi-tenant + per-role visibility policy; these
 * types just describe the shapes the UI consumes.
 */

// ── Enums / unions (kept in sync with src/utils/ats.constants.js) ───────────────

export type JobStatus = 'draft' | 'open' | 'closed' | 'filled';

export type JobEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'temporary'
  | 'freelance';

export type JobWorkMode = 'onsite' | 'remote' | 'hybrid';

export type JobSalaryPeriod = 'yearly' | 'monthly' | 'hourly';

export type ApplicationStatus =
  | 'new'
  | 'in_review'
  | 'shortlisted'
  | 'interviewing'
  | 'selected'
  | 'hired'
  | 'rejected'
  | 'on_hold';

export type ApplicationEventType =
  | 'created'
  | 'status_changed'
  | 'stage_changed'
  | 'note_added'
  | 'rating_updated';

/** One interview round in a job's pipeline. */
export interface InterviewRound {
  key: string;
  name: string;
  order: number;
}

/** Optional resume-screening guidance appended to the JD sent to the matcher. */
export interface ScreeningCriteria {
  must_have_skills?: string[];
  keywords?: string[];
  min_experience?: number | null;
}

/** Async resume-screening lifecycle for an application. */
export type ScreeningStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';

/** Score band label (mirrors the matcher's bands). */
export type ScreeningBand = 'excellent' | 'strong' | 'good' | 'fair' | 'weak';

/** One matched/missed requirement with optional supporting evidence. */
export interface ScreeningRequirement {
  requirement: string;
  evidence?: string | null;
}

/** Explainable breakdown stored alongside the score. */
export interface ScreeningBreakdown {
  band?: ScreeningBand | string | null;
  summary?: string | null;
  notes?: string | null;
  met_requirements?: ScreeningRequirement[];
  missed_requirements?: ScreeningRequirement[];
  provider?: string;
  request_id?: string | null;
  credits_used?: number | null;
}

export interface UserSummary {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface OrganizationSummary {
  uuid?: string;
  name: string;
  slug?: string;
}

// ── Job ─────────────────────────────────────────────────────────────────────────

export interface Job {
  uuid: string;
  job_code: string;
  title: string;
  description: string;
  department: string | null;
  location: string | null;
  employment_type: JobEmploymentType;
  work_mode: JobWorkMode;
  experience_min: number | null;
  experience_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  salary_period: JobSalaryPeriod | null;
  show_salary: boolean;
  openings: number;
  skills: string[];
  interview_rounds: InterviewRound[];
  screening_criteria: ScreeningCriteria;
  status: JobStatus;
  public_token: string;
  public_url: string;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  recruiter?: UserSummary | null;
  organization?: OrganizationSummary;
  /** Present on the single-job read. */
  application_count?: number;
}

/** An interview round on the way IN (name required; key/order derived server-side). */
export interface InterviewRoundInput {
  key?: string;
  name: string;
  order?: number;
}

export interface CreateJobRequest {
  action?: 'draft' | 'publish';
  title: string;
  description: string;
  department?: string | null;
  location?: string | null;
  employment_type?: JobEmploymentType;
  work_mode?: JobWorkMode;
  experience_min?: number | null;
  experience_max?: number | null;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;
  salary_period?: JobSalaryPeriod | null;
  show_salary?: boolean;
  openings?: number;
  skills?: string[];
  interview_rounds?: InterviewRoundInput[];
  screening_criteria?: ScreeningCriteria;
}

export type UpdateJobRequest = Partial<Omit<CreateJobRequest, 'action'>>;

// ── Application ───────────────────────────────────────────────────────────────

export interface ApplicationJobSummary {
  uuid: string;
  job_code: string;
  title: string;
  status: JobStatus;
  interview_rounds?: InterviewRound[];
}

export interface ApplicationAttachment {
  uuid: string;
  owner_type: string;
  field_name: string | null;
  url: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  uploaded_at: string;
}

export interface ApplicationEvent {
  uuid: string;
  entry_type: ApplicationEventType;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
  actor?: UserSummary | null;
}

export interface JobApplication {
  uuid: string;
  application_number: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  experience_years: number | null;
  cover_note: string | null;
  status: ApplicationStatus;
  stage_key: string | null;
  rating: number | null;
  decision_reason: string | null;
  source: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  // Resume screening (populated asynchronously).
  screening_status?: ScreeningStatus;
  screening_score?: number | null;
  screening_band?: ScreeningBand | string | null;
  screening_breakdown?: ScreeningBreakdown | null;
  screened_at?: string | null;
  job?: ApplicationJobSummary | null;
  reviewer?: UserSummary | null;
  /** Present on the single-application read. */
  attachments?: ApplicationAttachment[];
  events?: ApplicationEvent[];
}

/** Pipeline health summary returned alongside the ranked list. */
export interface ScreeningSummary {
  enabled: boolean;
  done: number;
  pending: number;
  processing: number;
  failed: number;
  skipped: number;
}

/** Response shape of GET /jobs/:uuid/applications/ranked. */
export interface RankedApplicationsResponse {
  data: JobApplication[];
  meta: {
    limit: number;
    total_ranked: number;
    screening: ScreeningSummary;
  };
}

/** Response of POST /jobs/:uuid/screen. */
export interface ScreenJobResult {
  queued: number;
  skipped_already_scored: number;
  enabled: boolean;
}

export interface ChangeApplicationStatusRequest {
  status: ApplicationStatus;
  stage_key?: string;
  decision_reason?: string;
  note?: string;
}

// ── Public careers page ─────────────────────────────────────────────────────────

export type CareersUnavailableReason = 'closed' | 'filled';

export interface PublicJob {
  title: string;
  status: JobStatus;
  available: boolean;
  unavailable_reason?: CareersUnavailableReason;
  organization?: { name: string; slug?: string };
  // Present only when available.
  description?: string;
  department?: string | null;
  location?: string | null;
  employment_type?: JobEmploymentType;
  work_mode?: JobWorkMode;
  experience_min?: number | null;
  experience_max?: number | null;
  openings?: number;
  skills?: string[];
  salary?: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: JobSalaryPeriod | null;
  };
  posted_at?: string | null;
}

export interface ApplyAcknowledgement {
  application_number: string;
  candidate_name: string;
  job_title: string;
}

// ── Display label maps ───────────────────────────────────────────────────────────

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  filled: 'Filled',
};

export const EMPLOYMENT_TYPE_LABELS: Record<JobEmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  freelance: 'Freelance',
};

export const WORK_MODE_LABELS: Record<JobWorkMode, string> = {
  onsite: 'On-site',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

export const SALARY_PERIOD_LABELS: Record<JobSalaryPeriod, string> = {
  yearly: 'per year',
  monthly: 'per month',
  hourly: 'per hour',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  selected: 'Selected',
  hired: 'Hired',
  rejected: 'Rejected',
  on_hold: 'On Hold',
};

export const SCREENING_BAND_LABELS: Record<ScreeningBand, string> = {
  excellent: 'Excellent',
  strong: 'Strong',
  good: 'Good',
  fair: 'Fair',
  weak: 'Weak',
};

/** Permission keys used for UX gating (backend re-enforces). */
export const ATS_PERMISSIONS = {
  jobCreate: 'job.create',
  jobRead: 'job.read',
  jobUpdate: 'job.update',
  jobDelete: 'job.delete',
  jobManageAll: 'job.manage_all',
  applicationRead: 'application.read',
  applicationUpdate: 'application.update',
  applicationDelete: 'application.delete',
  interviewCreate: 'interview.create',
  interviewRead: 'interview.read',
  interviewUpdate: 'interview.update',
  interviewDelete: 'interview.delete',
} as const;

export const JOB_STATUS_OPTIONS: JobStatus[] = ['draft', 'open', 'closed', 'filled'];
export const EMPLOYMENT_TYPE_OPTIONS: JobEmploymentType[] = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
  'freelance',
];
export const WORK_MODE_OPTIONS: JobWorkMode[] = ['onsite', 'remote', 'hybrid'];
export const SALARY_PERIOD_OPTIONS: JobSalaryPeriod[] = ['yearly', 'monthly', 'hourly'];
export const JOB_CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'SGD'];
export const APPLICATION_STATUS_OPTIONS: ApplicationStatus[] = [
  'new',
  'in_review',
  'shortlisted',
  'interviewing',
  'selected',
  'hired',
  'rejected',
  'on_hold',
];

// ── Interview scheduling ─────────────────────────────────────────────────────────
// Mirrors the backend (src/utils/ats.constants.js + interview.model.js). All datetimes
// are ISO strings; the UI sends/receives absolute instants plus an IANA `timezone`.

export type InterviewStatus =
  | 'scheduled'
  | 'rescheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type InterviewMode = 'video' | 'phone' | 'onsite';

export type InterviewProvider = 'google' | 'teams' | 'manual';

export type InterviewParticipantRole = 'organizer' | 'interviewer' | 'candidate';

export type InterviewResponseStatus = 'pending' | 'accepted' | 'declined' | 'tentative';

export interface InterviewParticipant {
  uuid: string;
  role: InterviewParticipantRole;
  email: string;
  name: string | null;
  response_status: InterviewResponseStatus;
  user: UserSummary | null;
}

export interface Interview {
  uuid: string;
  interview_number: string;
  stage_key: string;
  title: string | null;
  scheduled_start: string;
  scheduled_end: string;
  duration_minutes: number;
  timezone: string;
  mode: InterviewMode;
  provider: InterviewProvider;
  meeting_url: string | null;
  location: string | null;
  status: InterviewStatus;
  notes: string | null;
  outcome_note: string | null;
  cancel_reason: string | null;
  external_event_id: string | null;
  created_at: string;
  updated_at: string;
  organizer: UserSummary | null;
  job?: { uuid: string; job_code: string; title: string } | null;
  application?: {
    uuid: string;
    application_number: string;
    candidate_name: string;
    candidate_email: string;
    status: ApplicationStatus;
    stage_key: string | null;
  } | null;
  participants: InterviewParticipant[];
}

/**
 * Why a slot can't be booked:
 *   past      — the time has already started.
 *   busy      — overlaps an actual booking (shown at the exact booked time).
 *   too_close — clears the booking but falls inside the required gap (buffer) between
 *               interviews. Unbookable, but not itself a booked time.
 */
export type SlotUnavailableReason = 'past' | 'busy' | 'too_close';

/**
 * One slot returned by the availability endpoint (absolute ISO instants). Every
 * working-hour slot is returned; `available` is false for past/busy ones so the UI can
 * show them greyed-out with a reason (Calendly-style) instead of hiding them.
 */
export interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
  reason: SlotUnavailableReason | null;
}

export interface AvailabilityResponse {
  timezone: string;
  duration_minutes: number;
  slot_granularity_minutes: number;
  buffer_minutes: number;
  interviewers: { uuid: string; name: string; email: string }[];
  slots: AvailabilitySlot[];
}

export interface AvailabilityQuery {
  date_from: string;
  date_to: string;
  timezone: string;
  duration_minutes?: number;
  interviewer_uuids: string[];
}

export interface CreateInterviewRequest {
  stage_key: string;
  start: string;
  duration_minutes?: number;
  timezone: string;
  mode: InterviewMode;
  provider?: InterviewProvider;
  interviewer_uuids: string[];
  meeting_url?: string | null;
  location?: string | null;
  title?: string | null;
  notes?: string | null;
}

export interface RescheduleInterviewRequest {
  start: string;
  duration_minutes?: number;
  timezone?: string;
  meeting_url?: string | null;
  location?: string | null;
}

export interface CancelInterviewRequest {
  reason?: string | null;
}

export interface CompleteInterviewRequest {
  outcome: 'completed' | 'no_show';
  outcome_note?: string | null;
}

/** Provider availability snapshot from GET /interviews/providers. */
export interface InterviewProviderInfo {
  key: InterviewProvider;
  enabled: boolean;
  configured: boolean;
}

/** One org user offered as an interviewer (from GET /applications/:uuid/interviewers). */
export interface InterviewerOption {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  video: 'Video call',
  phone: 'Phone',
  onsite: 'On-site',
};

export const INTERVIEW_PROVIDER_LABELS: Record<InterviewProvider, string> = {
  google: 'Google Calendar (Meet)',
  teams: 'Microsoft Teams',
  manual: 'Manual (paste link)',
};

export const INTERVIEW_MODE_OPTIONS: InterviewMode[] = ['video', 'phone', 'onsite'];
export const INTERVIEW_PROVIDER_OPTIONS: InterviewProvider[] = ['google', 'teams', 'manual'];

/** Interview statuses that are still active (can be rescheduled/cancelled/completed). */
export const INTERVIEW_ACTIVE_STATUSES: InterviewStatus[] = ['scheduled', 'rescheduled'];
