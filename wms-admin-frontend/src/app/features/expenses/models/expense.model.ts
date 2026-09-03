/**
 * Expense domain types + constants for the expenses feature.
 * These mirror the backend contract (title/category/amount/status, creator/reviewer).
 */

/** Expense permission keys (must match backend config/rbac.js). */
export const EXPENSE_PERMISSIONS = {
  create: 'expense.create',
  read: 'expense.read',
  update: 'expense.update',
  delete: 'expense.delete',
  /** The reviewer capability: see all org expenses + approve/reject. */
  review: 'expense.review',
} as const;

export const EXPENSE_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  'travel',
  'meals',
  'accommodation',
  'supplies',
  'equipment',
  'software',
  'training',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'] as const;
export type ExpenseCurrency = (typeof EXPENSE_CURRENCIES)[number];

/** A lightweight user reference embedded on an expense (creator / reviewer). */
export interface ExpenseUser {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Legacy name-only attachment metadata kept on the expense row (`attachments`).
 * Retained for backward compatibility; new uploads use ExpenseFile below.
 */
export interface ExpenseAttachment {
  name: string;
}

/**
 * A real uploaded expense file (bytes stored in object storage, link kept in the DB).
 * Returned on the expense read path as `expense_attachments`, and by the upload
 * endpoint. `url` is the direct link to open/download the file.
 */
export interface ExpenseFile {
  uuid: string;
  url: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  uploaded_at?: string;
}

/** Expense row as returned by the backend list/detail endpoints. */
export interface Expense {
  uuid: string;
  expense_number: string;
  title: string;
  category: ExpenseCategory;
  expense_date: string;
  notes: string | null;
  amount: number;
  currency: ExpenseCurrency;
  status: ExpenseStatus;
  /** Legacy name-only metadata (kept for compatibility). */
  attachments: ExpenseAttachment[];
  /** Real uploaded files with links (the ones users open/download). */
  expense_attachments: ExpenseFile[];
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at?: string;
  updated_at?: string;
  created_by: ExpenseUser | null;
  reviewed_by: ExpenseUser | null;
  organization?: { uuid: string; name: string; slug: string };
}

/** How the owner wants to save: keep as a draft, or submit for approval. */
export type ExpenseSaveAction = 'draft' | 'submit';

/** Payload to create an expense. status is derived from `action` on the backend. */
export interface CreateExpenseRequest {
  action: ExpenseSaveAction;
  title: string;
  category: ExpenseCategory;
  expense_date: string;
  notes?: string;
  amount: number;
  currency: ExpenseCurrency;
  /** Attachment names only (no bytes). Persisted as-is for now. */
  attachments?: ExpenseAttachment[];
}

/** Payload to update expense content (owner, draft/rejected only). */
export interface UpdateExpenseRequest {
  action?: ExpenseSaveAction;
  title?: string;
  category?: ExpenseCategory;
  expense_date?: string;
  notes?: string;
  amount?: number;
  currency?: ExpenseCurrency;
  attachments?: ExpenseAttachment[];
}

/** Reviewer decision on a submitted expense. */
export interface ReviewExpenseRequest {
  decision: 'approve' | 'reject';
  /** Required when decision is 'reject'. */
  rejection_reason?: string;
}

/** Human labels for enum values (UI display only). */
export const STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  travel: 'Travel',
  meals: 'Meals',
  accommodation: 'Accommodation',
  supplies: 'Supplies',
  equipment: 'Equipment',
  software: 'Software',
  training: 'Training',
  other: 'Other',
};
