import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  Expense,
  ExpenseFile,
  CreateExpenseRequest,
  UpdateExpenseRequest,
  ReviewExpenseRequest,
} from '../models/expense.model';

/**
 * Data access for the expenses feature.
 *
 * The backend enforces the real multi-tenant + per-role policy (visibility scoped to
 * the caller's org, owner-only edits on draft/rejected, reviewer-only approve/reject).
 * This service just maps calls to endpoints; every list flows through ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class ExpensesService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable, filterable list of visible expenses. */
  list(query: ListQuery): Observable<PaginatedResult<Expense>> {
    return this.api.list<Expense>(API_ENDPOINTS.expenses.root, query);
  }

  getByUuid(uuid: string): Observable<Expense> {
    return this.api.get<Expense>(API_ENDPOINTS.expenses.byUuid(uuid));
  }

  create(payload: CreateExpenseRequest): Observable<Expense> {
    return this.api.post<Expense>(API_ENDPOINTS.expenses.root, payload);
  }

  update(uuid: string, payload: UpdateExpenseRequest): Observable<Expense> {
    return this.api.put<Expense>(API_ENDPOINTS.expenses.byUuid(uuid), payload);
  }

  /** Submit a draft/rejected expense for approval (owner only). */
  submit(uuid: string): Observable<Expense> {
    return this.api.patch<Expense>(API_ENDPOINTS.expenses.submit(uuid), {});
  }

  /** Approve or reject a submitted expense (reviewers only). */
  review(uuid: string, payload: ReviewExpenseRequest): Observable<Expense> {
    return this.api.patch<Expense>(API_ENDPOINTS.expenses.review(uuid), payload);
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.expenses.byUuid(uuid));
  }

  // ── Attachments (real file uploads) ────────────────────────────────────────

  /**
   * Upload one or more real files to an expense as multipart/form-data.
   *
   * We build a FormData and post it through ApiService. Angular's HttpClient sets the
   * correct `multipart/form-data; boundary=...` header automatically for FormData, and
   * the auth interceptor only adds the Bearer token (it never sets Content-Type), so
   * the multipart boundary is preserved. Returns the created attachment rows.
   */
  uploadAttachments(uuid: string, files: File[]): Observable<ExpenseFile[]> {
    const form = new FormData();
    // The backend uses uploadFiles.any(), so the field name is free-form; the expense
    // owner is resolved server-side from the :uuid, never sent in the body.
    files.forEach((file) => form.append('files', file, file.name));
    return this.api.post<ExpenseFile[]>(API_ENDPOINTS.expenses.attachments(uuid), form);
  }

  /** List an expense's uploaded files. */
  listAttachments(uuid: string): Observable<ExpenseFile[]> {
    return this.api.get<ExpenseFile[]>(API_ENDPOINTS.expenses.attachments(uuid));
  }

  /** Delete one uploaded file from an expense. */
  deleteAttachment(uuid: string, attachmentUuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.expenses.attachment(uuid, attachmentUuid));
  }
}
