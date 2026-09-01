import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  Expense,
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
}
