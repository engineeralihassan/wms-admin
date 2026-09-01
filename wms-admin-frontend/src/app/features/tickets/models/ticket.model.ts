/**
 * Ticket domain types + constants for the tickets feature.
 * These mirror the backend contract (subject/status/priority, creator/assignee).
 */

/** Ticket permission keys (must match backend config/rbac.js). */
export const TICKET_PERMISSIONS = {
  create: 'ticket.create',
  read: 'ticket.read',
  update: 'ticket.update',
  assign: 'ticket.assign',
  statusUpdate: 'ticket.status_update',
  delete: 'ticket.delete',
} as const;

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** A lightweight user reference embedded on a ticket (creator / assignee). */
export interface TicketUser {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * A ticket attachment. For now we persist ONLY the file name (no bytes/storage yet).
 * The shape is intentionally open for the future: when S3 lands we add `key`, `size`,
 * `mime`, `url` here without changing callers that only read `name`.
 */
export interface TicketAttachment {
  name: string;
}

/** Ticket row as returned by the backend list/detail endpoints. */
export interface Ticket {
  uuid: string;
  ticket_number: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  resolved_at: string | null;
  closed_at: string | null;
  created_at?: string;
  updated_at?: string;
  created_by: TicketUser | null;
  assigned_to: TicketUser | null;
  attachments: TicketAttachment[];
  organization?: { uuid: string; name: string; slug: string };
}

/** Payload to create a ticket. */
export interface CreateTicketRequest {
  subject: string;
  description: string;
  priority: TicketPriority;
  /** Optional pre-assignment (only honored by the backend for managers). */
  assigned_to?: string;
  /** Attachment names only (no bytes). Persisted as-is for now. */
  attachments?: TicketAttachment[];
}

/** Payload to update ticket content. */
export interface UpdateTicketRequest {
  subject?: string;
  description?: string;
  priority?: TicketPriority;
}

/** Human labels for enum values (UI display only). */
export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
