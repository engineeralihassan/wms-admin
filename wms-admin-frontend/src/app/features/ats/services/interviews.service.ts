import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  CancelInterviewRequest,
  CompleteInterviewRequest,
  CreateInterviewRequest,
  Interview,
  InterviewerOption,
  InterviewProviderInfo,
  RescheduleInterviewRequest,
} from '../models/ats.model';

/**
 * Data access for interview scheduling.
 *
 * Interviews are booked + listed under their application; single-interview lifecycle
 * actions (reschedule / cancel / complete) address the interview directly. The backend
 * enforces that a recruiter can only touch interviews on candidates they can see, and
 * creates/updates the real calendar event (Google/Teams/manual) server-side.
 */
@Injectable({ providedIn: 'root' })
export class InterviewsService {
  private readonly api = inject(ApiService);

  /** Which calendar/meeting providers are enabled on the server (drives the UI). */
  getProviders(): Observable<InterviewProviderInfo[]> {
    return this.api.get<InterviewProviderInfo[]>(API_ENDPOINTS.interviews.providers);
  }

  /** Bookable slots for the application's next interview. */
  getAvailability(applicationUuid: string, query: AvailabilityQuery): Observable<AvailabilityResponse> {
    return this.api.get<AvailabilityResponse>(
      API_ENDPOINTS.applications.interviewAvailability(applicationUuid),
      {
        date_from: query.date_from,
        date_to: query.date_to,
        timezone: query.timezone,
        duration_minutes: query.duration_minutes ?? null,
        // The backend accepts a repeated / array param; join is serialized as CSV which
        // Joi's alternatives(array, single) tolerates, but we send each uuid explicitly
        // by relying on the query serializer. Kept as CSV here for a single GET param.
        interviewer_uuids: query.interviewer_uuids.join(','),
      },
    );
  }

  /**
   * Org users offered as interviewer options for this application. Guarded by
   * interview.create on the backend (NOT user.read), so a recruiter can pick a panel
   * without access to the Users module.
   */
  listInterviewers(applicationUuid: string): Observable<InterviewerOption[]> {
    return new Observable<InterviewerOption[]>((subscriber) => {
      this.api
        .list<InterviewerOption>(API_ENDPOINTS.applications.interviewers(applicationUuid), {
          limit: 100,
          sortBy: 'first_name',
          sortDir: 'asc',
        })
        .subscribe({
          next: (res) => {
            subscriber.next(res.data);
            subscriber.complete();
          },
          error: (err) => subscriber.error(err),
        });
    });
  }

  /** Interviews already booked for an application. */
  listForApplication(applicationUuid: string): Observable<Interview[]> {
    // The list endpoint is paginated server-side; we read the data array via list().
    return new Observable<Interview[]>((subscriber) => {
      this.api
        .list<Interview>(API_ENDPOINTS.applications.interviews(applicationUuid), {
          limit: 100,
          sortBy: 'scheduled_start',
          sortDir: 'asc',
        })
        .subscribe({
          next: (res) => {
            subscriber.next(res.data);
            subscriber.complete();
          },
          error: (err) => subscriber.error(err),
        });
    });
  }

  /** Schedule a new interview for a shortlisted/interviewing candidate. */
  schedule(applicationUuid: string, payload: CreateInterviewRequest): Observable<Interview> {
    return this.api.post<Interview>(
      API_ENDPOINTS.applications.interviews(applicationUuid),
      payload,
    );
  }

  getByUuid(uuid: string): Observable<Interview> {
    return this.api.get<Interview>(API_ENDPOINTS.interviews.byUuid(uuid));
  }

  reschedule(uuid: string, payload: RescheduleInterviewRequest): Observable<Interview> {
    return this.api.patch<Interview>(API_ENDPOINTS.interviews.reschedule(uuid), payload);
  }

  cancel(uuid: string, payload: CancelInterviewRequest = {}): Observable<Interview> {
    return this.api.patch<Interview>(API_ENDPOINTS.interviews.cancel(uuid), payload);
  }

  complete(uuid: string, payload: CompleteInterviewRequest): Observable<Interview> {
    return this.api.patch<Interview>(API_ENDPOINTS.interviews.complete(uuid), payload);
  }
}
