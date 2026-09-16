/**
 * Leave / Time Off domain types + constants for the leaves feature.
 * These mirror the backend contract (src/models/leave-request.model.js,
 * src/utils/leave.constants.js, src/config/rbac.js).
 */

/** Leave permission keys (must match backend config/rbac.js). */
export const LEAVE_PERMISSIONS = {
  create: 'leave.create',
  read: 'leave.read',
  update: 'leave.update',
  delete: 'leave.delete',
  /** The approver capability: see all org leave + approve/reject/cancel. */
  approve: 'leave.approve',
  /** The allocator capability: manage leave types + allocate balances. */
  allocate: 'leave.allocate',
} as const;

export const LEAVE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_DAY_PORTIONS = ['full', 'first_half', 'second_half'] as const;
export type LeaveDayPortion = (typeof LEAVE_DAY_PORTIONS)[number];

/** A lightweight user reference embedded on a leave request (applicant / reviewer). */
export interface LeaveUser {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * A leave attachment. For now we persist ONLY the file name (no bytes/storage yet).
 * Shape is intentionally open for the future (S3: key/size/mime/url) without changing
 * callers that only read `name`.
 */
export interface LeaveAttachment {
  name: string;
}

/**
 * A real uploaded leave file (bytes stored in object storage, link kept in the DB).
 * Returned on the leave read path as `leave_attachments`, and by the upload endpoint.
 * `url` is the direct link to open/download the file. Mirrors the expense ExpenseFile.
 */
export interface LeaveFile {
  uuid: string;
  url: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  uploaded_at?: string;
}

/** A leave type as returned by the backend (per-organization catalog). */
export interface LeaveType {
  uuid: string;
  key: string;
  name: string;
  is_paid: boolean;
  requires_balance: boolean;
  color: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Leave request row as returned by the backend list/detail endpoints. */
export interface LeaveRequest {
  uuid: string;
  leave_number: string;
  start_date: string;
  end_date: string;
  day_portion: LeaveDayPortion;
  total_days: number;
  reason: string | null;
  status: LeaveStatus;
  /** Legacy name-only metadata (kept for compatibility). */
  attachments: LeaveAttachment[];
  /** Real uploaded files with links (the ones users open/download). */
  leave_attachments: LeaveFile[];
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at?: string;
  updated_at?: string;
  leave_type: Pick<LeaveType, 'uuid' | 'key' | 'name' | 'is_paid' | 'requires_balance' | 'color'> | null;
  applicant: LeaveUser | null;
  reviewer: LeaveUser | null;
  organization?: { uuid: string; name: string; slug: string };
}

/** A user's balance for one leave type in one period year. */
export interface LeaveBalance {
  uuid: string;
  period_year: number;
  allocated: number;
  used: number;
  pending: number;
  available: number;
  leave_type: LeaveRequest['leave_type'];
  user?: LeaveUser | null;
  created_at?: string;
  updated_at?: string;
}

/** Response shape of GET /leaves/balances/me. */
export interface MyBalancesResponse {
  period_year: number;
  balances: LeaveBalance[];
}

/** A single expanded leave day from GET /leaves/calendar. */
export interface LeaveCalendarDay {
  date: string;
  leave_uuid: string;
  leave_type_key: string | null;
  day_portion: LeaveDayPortion;
  status: LeaveStatus;
}

/** How the applicant wants to save: keep as a draft, or submit for approval. */
export type LeaveSaveAction = 'draft' | 'submit';

/** Payload to create a leave request. status is derived from `action` on the backend. */
export interface CreateLeaveRequest {
  action: LeaveSaveAction;
  leave_type: string;
  start_date: string;
  end_date: string;
  day_portion?: LeaveDayPortion;
  reason?: string;
  attachments?: LeaveAttachment[];
}

/** Payload to update leave content (applicant, draft/rejected only). */
export interface UpdateLeaveRequest {
  action?: LeaveSaveAction;
  leave_type?: string;
  start_date?: string;
  end_date?: string;
  day_portion?: LeaveDayPortion;
  reason?: string;
  attachments?: LeaveAttachment[];
}

/** Approver decision on a submitted leave request. */
export interface DecideLeaveRequest {
  decision: 'approve' | 'reject';
  /** Required when decision is 'reject'. */
  rejection_reason?: string;
}

/** Payload to create a leave type (allocator only). */
export interface CreateLeaveTypeRequest {
  key: string;
  name: string;
  is_paid: boolean;
  requires_balance?: boolean;
  color?: string | null;
  is_active?: boolean;
}

/** Payload to allocate/set a user's balance (allocator only). */
export interface AllocateBalanceRequest {
  user: string;
  leave_type: string;
  period_year: number;
  allocated: number;
}

/** Human labels for enum values (UI display only). */
export const STATUS_LABELS: Record<LeaveStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

export const DAY_PORTION_LABELS: Record<LeaveDayPortion, string> = {
  full: 'Full day',
  first_half: 'First half',
  second_half: 'Second half',
};
