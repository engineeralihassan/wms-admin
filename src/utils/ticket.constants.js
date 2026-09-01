const TICKET_PRIORITIES = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
});

const TICKET_STATUSES = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
});

const TICKET_SORT_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'ticket_number',
  'priority',
  'status',
]);

/**
 * Attachment rules (single source of truth on the backend).
 * We currently persist ONLY the file name — no bytes/storage yet. These limits guard
 * the metadata we accept; when S3 lands, the same allow-lists apply to real uploads.
 */
const TICKET_ATTACHMENT_MAX_FILES = 3;
const TICKET_ATTACHMENT_MAX_NAME_LENGTH = 255;

/** Allowed file extensions (lowercase, with dot). Mirrors the FE preset catalog. */
const TICKET_ATTACHMENT_ALLOWED_EXTENSIONS = Object.freeze([
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
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_SORT_FIELDS,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_MAX_NAME_LENGTH,
  TICKET_ATTACHMENT_ALLOWED_EXTENSIONS,
};
