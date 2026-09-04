/**
 * Timesheet domain types + constants for the timesheets feature.
 * These mirror the backend contract (weekly sheet per project, 7 daily entries,
 * draft/submit/approve workflow with a lock date).
 */

/** Timesheet permission keys (must match backend config/rbac.js). */
export const TIMESHEET_PERMISSIONS = {
  create: 'timesheet.create',
  read: 'timesheet.read',
  update: 'timesheet.update',
  delete: 'timesheet.delete',
  /** The approver capability: see all org timesheets + approve/reject/correct. */
  approve: 'timesheet.approve',
} as const;

/**
 * Lifecycle of a weekly timesheet (matches backend timesheet.constants):
 *   unsubmitted → submitted → approved | rejected, plus locked when the lock date
 *   passes while still unsubmitted.
 */
export const TIMESHEET_STATUSES = [
  'unsubmitted',
  'submitted',
  'approved',
  'rejected',
  'locked',
] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/** Approver decision on a submitted timesheet. */
export type TimesheetDecision = 'approve' | 'reject';

/** A lightweight user reference embedded on a timesheet (owner / reviewer). */
export interface TimesheetUser {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** A lightweight project reference embedded on a timesheet + the picker option. */
export interface TimesheetProject {
  uuid: string;
  project_code: string;
  name: string;
  status?: string;
}

/** One day's logged hours within a weekly timesheet. */
export interface TimesheetEntry {
  uuid: string;
  work_date: string;
  hours: number;
  note: string | null;
}

/** A real uploaded timesheet file (bytes in object storage, link in the DB). */
export interface TimesheetFile {
  uuid: string;
  url: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  uploaded_at?: string;
}

/** Timesheet row/detail as returned by the backend list/detail endpoints. */
export interface Timesheet {
  uuid: string;
  timesheet_number: string;
  week_start_date: string;
  week_end_date: string;
  due_date: string;
  lock_date: string;
  total_hours: number;
  status: TimesheetStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  review_note: string | null;
  auto_generated: boolean;
  /** The 7 daily rows (present on the detail read; may be omitted in the list). */
  entries: TimesheetEntry[];
  /** Real uploaded files with links. */
  attachments: TimesheetFile[];
  created_at?: string;
  updated_at?: string;
  project: TimesheetProject | null;
  owner: TimesheetUser | null;
  reviewed_by: TimesheetUser | null;
  organization?: { uuid: string; name: string; slug: string };
}

/** Payload to open (ensure) a week's timesheet for a project. */
export interface CreateTimesheetRequest {
  /** The project's public uuid. */
  project: string;
  /** Optional date within the target week (defaults to the current week). */
  week_date?: string;
}

/** One day in a save-entries payload. */
export interface TimesheetEntryInput {
  work_date: string;
  hours?: number;
  note?: string | null;
}

/** Payload to bulk-save the week's daily hours/notes (owner draft save). */
export interface SaveEntriesRequest {
  entries: TimesheetEntryInput[];
}

/** Approver decision on a submitted timesheet. */
export interface ReviewTimesheetRequest {
  decision: TimesheetDecision;
  /** Required when decision is 'reject'. */
  rejection_reason?: string;
  review_note?: string;
}

/** Approver correction: edit entries and/or move status, with an explanatory note. */
export interface CorrectTimesheetRequest {
  entries?: TimesheetEntryInput[];
  status?: Extract<TimesheetStatus, 'submitted' | 'approved'>;
  review_note?: string;
}

/** Human labels for status values (UI display only). */
export const STATUS_LABELS: Record<TimesheetStatus, string> = {
  unsubmitted: 'Unsubmitted',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  locked: 'Locked',
};
