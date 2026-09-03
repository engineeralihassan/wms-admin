import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import { map } from 'rxjs';
import type {
  ChangeApplicationStatusRequest,
  CreateJobRequest,
  Job,
  JobApplication,
  JobStatus,
  RankedApplicationsResponse,
  ScreenJobResult,
  UpdateJobRequest,
} from '../models/ats.model';

/**
 * Data access for the recruiter-facing ATS (jobs + applications).
 *
 * The backend enforces the real policy: a recruiter sees/acts only on their OWN jobs
 * and those jobs' applications; an org admin (job.manage_all) sees the whole org. This
 * service just maps calls to endpoints; lists flow through ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class JobsService {
  private readonly api = inject(ApiService);

  // ── Jobs ─────────────────────────────────────────────────────────────────
  list(query: ListQuery): Observable<PaginatedResult<Job>> {
    return this.api.list<Job>(API_ENDPOINTS.jobs.root, query);
  }

  getByUuid(uuid: string): Observable<Job> {
    return this.api.get<Job>(API_ENDPOINTS.jobs.byUuid(uuid));
  }

  create(payload: CreateJobRequest): Observable<Job> {
    return this.api.post<Job>(API_ENDPOINTS.jobs.root, payload);
  }

  update(uuid: string, payload: UpdateJobRequest): Observable<Job> {
    return this.api.put<Job>(API_ENDPOINTS.jobs.byUuid(uuid), payload);
  }

  /** Publish / close / mark filled / reopen a job. */
  changeStatus(uuid: string, status: JobStatus): Observable<Job> {
    return this.api.patch<Job>(API_ENDPOINTS.jobs.status(uuid), { status });
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.jobs.byUuid(uuid));
  }

  // ── Applications ───────────────────────────────────────────────────────────
  listApplications(jobUuid: string, query: ListQuery): Observable<PaginatedResult<JobApplication>> {
    return this.api.list<JobApplication>(API_ENDPOINTS.jobs.applications(jobUuid), query);
  }

  getApplication(uuid: string): Observable<JobApplication> {
    return this.api.get<JobApplication>(API_ENDPOINTS.applications.byUuid(uuid));
  }

  /**
   * Top-N candidates for a job, ranked by cached resume-screening score. Reads the
   * already-computed scores, so this is instant regardless of applicant count.
   */
  listRankedApplications(jobUuid: string, limit = 10): Observable<RankedApplicationsResponse> {
    return this.api
      .list<JobApplication>(API_ENDPOINTS.jobs.rankedApplications(jobUuid), { limit })
      .pipe(
        map((res) => ({
          data: res.data,
          meta: res.meta as unknown as RankedApplicationsResponse['meta'],
        })),
      );
  }

  /**
   * Manually (re)screen a job's applications. By default only screens candidates that
   * don't already have a score; pass rescoreAll to force a fresh score on everyone
   * (spends more credits).
   */
  screenJob(jobUuid: string, rescoreAll = false): Observable<ScreenJobResult> {
    return this.api.post<ScreenJobResult>(API_ENDPOINTS.jobs.screen(jobUuid), {
      rescore_all: rescoreAll,
    });
  }

  /** Move an application through its hiring lifecycle. */
  changeApplicationStatus(
    uuid: string,
    payload: ChangeApplicationStatusRequest,
  ): Observable<JobApplication> {
    return this.api.patch<JobApplication>(API_ENDPOINTS.applications.status(uuid), payload);
  }

  rateApplication(uuid: string, rating: number): Observable<JobApplication> {
    return this.api.patch<JobApplication>(API_ENDPOINTS.applications.rating(uuid), { rating });
  }

  addApplicationNote(uuid: string, note: string): Observable<JobApplication> {
    return this.api.post<JobApplication>(API_ENDPOINTS.applications.notes(uuid), { note });
  }

  removeApplication(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.applications.byUuid(uuid));
  }
}
