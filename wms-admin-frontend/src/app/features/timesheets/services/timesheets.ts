import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  Timesheet,
  TimesheetProject,
  CreateTimesheetRequest,
  SaveEntriesRequest,
  ReviewTimesheetRequest,
  CorrectTimesheetRequest,
} from '../models/timesheet.model';

/**
 * Data access for the timesheets feature.
 *
 * The backend enforces the real multi-tenant + per-role policy (visibility scoped to
 * the caller's org, owner-only edits before the lock date, approver-only
 * review/correct). This service just maps calls to endpoints; every list flows through
 * ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class TimesheetsService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable, filterable list of visible timesheets. */
  list(query: ListQuery): Observable<PaginatedResult<Timesheet>> {
    return this.api.list<Timesheet>(API_ENDPOINTS.timesheets.root, query);
  }

  /** Projects the caller may log time against (the create picker). */
  projects(): Observable<TimesheetProject[]> {
    return this.api.get<TimesheetProject[]>(API_ENDPOINTS.timesheets.projects);
  }

  getByUuid(uuid: string): Observable<Timesheet> {
    return this.api.get<Timesheet>(API_ENDPOINTS.timesheets.byUuid(uuid));
  }

  /** Open (ensure) this/a chosen week's timesheet for a project. */
  create(payload: CreateTimesheetRequest): Observable<Timesheet> {
    return this.api.post<Timesheet>(API_ENDPOINTS.timesheets.root, payload);
  }

  /** Bulk-save the week's daily hours/notes (owner, draft save). */
  saveEntries(uuid: string, payload: SaveEntriesRequest): Observable<Timesheet> {
    return this.api.patch<Timesheet>(API_ENDPOINTS.timesheets.entries(uuid), payload);
  }

  /** Submit the week for approval (owner). */
  submit(uuid: string): Observable<Timesheet> {
    return this.api.post<Timesheet>(API_ENDPOINTS.timesheets.submit(uuid), {});
  }

  /** Withdraw a submitted week back to unsubmitted (owner). */
  withdraw(uuid: string): Observable<Timesheet> {
    return this.api.post<Timesheet>(API_ENDPOINTS.timesheets.withdraw(uuid), {});
  }

  /** Approve or reject a submitted week (approvers only). */
  review(uuid: string, payload: ReviewTimesheetRequest): Observable<Timesheet> {
    return this.api.post<Timesheet>(API_ENDPOINTS.timesheets.review(uuid), payload);
  }

  /** Approver correction: edit entries / accept, with a note (approvers only). */
  correct(uuid: string, payload: CorrectTimesheetRequest): Observable<Timesheet> {
    return this.api.patch<Timesheet>(API_ENDPOINTS.timesheets.byUuid(uuid), payload);
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.timesheets.byUuid(uuid));
  }
}
