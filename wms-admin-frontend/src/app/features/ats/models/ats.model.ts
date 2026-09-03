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
  job?: ApplicationJobSummary | null;
  reviewer?: UserSummary | null;
  /** Present on the single-application read. */
  attachments?: ApplicationAttachment[];
  events?: ApplicationEvent[];
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
