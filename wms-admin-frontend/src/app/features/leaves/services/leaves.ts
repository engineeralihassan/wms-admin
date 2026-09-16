import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  AllocateBalanceRequest,
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  DecideLeaveRequest,
  LeaveBalance,
  LeaveCalendarDay,
  LeaveFile,
  LeaveRequest,
  LeaveType,
  MyBalancesResponse,
  UpdateLeaveRequest,
} from '../models/leave.model';

/**
 * Data access for the leaves feature.
 *
 * The backend enforces the real multi-tenant + per-role policy (visibility scoped to
 * the caller's org, owner-only edits on draft/rejected, approver-only decisions,
 * allocator-only type/balance management, paid-balance checks on submit). This service
 * just maps calls to endpoints; every list flows through ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class LeavesService {
  private readonly api = inject(ApiService);

  // ---- Requests ----

  /** Paginated, searchable, sortable, filterable list of visible leave requests. */
  list(query: ListQuery): Observable<PaginatedResult<LeaveRequest>> {
    return this.api.list<LeaveRequest>(API_ENDPOINTS.leaves.root, query);
  }

  getByUuid(uuid: string): Observable<LeaveRequest> {
    return this.api.get<LeaveRequest>(API_ENDPOINTS.leaves.byUuid(uuid));
  }

  create(payload: CreateLeaveRequest): Observable<LeaveRequest> {
    return this.api.post<LeaveRequest>(API_ENDPOINTS.leaves.root, payload);
  }

  update(uuid: string, payload: UpdateLeaveRequest): Observable<LeaveRequest> {
    return this.api.put<LeaveRequest>(API_ENDPOINTS.leaves.byUuid(uuid), payload);
  }

  /** Submit a draft/rejected request for approval (owner only; runs paid-balance check). */
  submit(uuid: string): Observable<LeaveRequest> {
    return this.api.patch<LeaveRequest>(API_ENDPOINTS.leaves.submit(uuid), {});
  }

  /** Withdraw a still-pending request (applicant only). */
  withdraw(uuid: string): Observable<LeaveRequest> {
    return this.api.patch<LeaveRequest>(API_ENDPOINTS.leaves.withdraw(uuid), {});
  }

  /** Approve or reject a submitted request (approvers only). */
  decide(uuid: string, payload: DecideLeaveRequest): Observable<LeaveRequest> {
    return this.api.patch<LeaveRequest>(API_ENDPOINTS.leaves.decision(uuid), payload);
  }

  /** Cancel a submitted/approved request (approvers only; releases balance). */
  cancel(uuid: string): Observable<LeaveRequest> {
    return this.api.patch<LeaveRequest>(API_ENDPOINTS.leaves.cancel(uuid), {});
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.leaves.byUuid(uuid));
  }

  // ── Attachments (real file uploads) ────────────────────────────────────────

  /**
   * Upload one or more real files to a leave request as multipart/form-data.
   *
   * We build a FormData and post it through ApiService. Angular's HttpClient sets the
   * correct `multipart/form-data; boundary=...` header automatically for FormData, and
   * the auth interceptor only adds the Bearer token (it never sets Content-Type), so
   * the multipart boundary is preserved. Returns the created attachment rows.
   */
  uploadAttachments(uuid: string, files: File[]): Observable<LeaveFile[]> {
    const form = new FormData();
    // The backend uses uploadFiles.any(), so the field name is free-form; the request
    // owner is resolved server-side from the :uuid, never sent in the body.
    files.forEach((file) => form.append('files', file, file.name));
    return this.api.post<LeaveFile[]>(API_ENDPOINTS.leaves.attachments(uuid), form);
  }

  /** List a leave request's uploaded files. */
  listAttachments(uuid: string): Observable<LeaveFile[]> {
    return this.api.get<LeaveFile[]>(API_ENDPOINTS.leaves.attachments(uuid));
  }

  /** Delete one uploaded file from a leave request. */
  deleteAttachment(uuid: string, attachmentUuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.leaves.attachment(uuid, attachmentUuid));
  }

  // ---- Balances (self) ----

  /** The caller's own balances (defaults to the current period year on the backend). */
  myBalances(periodYear?: number): Observable<MyBalancesResponse> {
    return this.api.get<MyBalancesResponse>(
      API_ENDPOINTS.leaves.myBalances,
      periodYear ? { period_year: periodYear } : undefined,
    );
  }

  /** Timesheet-facing calendar of leave days in a range. */
  calendar(params: {
    from: string;
    to: string;
    user?: string;
    include_pending?: boolean;
  }): Observable<LeaveCalendarDay[]> {
    return this.api.get<LeaveCalendarDay[]>(API_ENDPOINTS.leaves.calendar, params);
  }

  // ---- Leave types ----

  /** List leave types for the org (all active; pass includeInactive for the full set). */
  listTypes(includeInactive = false): Observable<LeaveType[]> {
    return this.api.get<LeaveType[]>(
      API_ENDPOINTS.leaves.types,
      includeInactive ? { include_inactive: true } : undefined,
    );
  }

  createType(payload: CreateLeaveTypeRequest): Observable<LeaveType> {
    return this.api.post<LeaveType>(API_ENDPOINTS.leaves.types, payload);
  }

  updateType(uuid: string, payload: Partial<CreateLeaveTypeRequest>): Observable<LeaveType> {
    return this.api.put<LeaveType>(API_ENDPOINTS.leaves.typeByUuid(uuid), payload);
  }

  // ---- Balance administration (allocator only) ----

  listBalances(query: ListQuery, user?: string): Observable<PaginatedResult<LeaveBalance>> {
    const q: ListQuery & { user?: string } = { ...query };
    if (user) q.user = user;
    return this.api.list<LeaveBalance>(API_ENDPOINTS.leaves.balances, q as ListQuery);
  }

  allocateBalance(payload: AllocateBalanceRequest): Observable<LeaveBalance> {
    return this.api.post<LeaveBalance>(API_ENDPOINTS.leaves.balances, payload);
  }
}
