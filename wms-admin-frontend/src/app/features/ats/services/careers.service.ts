import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ApplyAcknowledgement, PublicJob } from '../models/ats.model';

/**
 * Data access for the PUBLIC careers page (unauthenticated). These endpoints are open
 * on the backend (rate-limited) and routed on the job's public token. The candidate is
 * not a logged-in user, so no auth token is expected.
 */
@Injectable({ providedIn: 'root' })
export class CareersService {
  private readonly api = inject(ApiService);

  /** Fetch a shared job by its public token (or the "not available" state). */
  getPublicJob(token: string): Observable<PublicJob> {
    return this.api.get<PublicJob>(API_ENDPOINTS.careers.byToken(token));
  }

  /**
   * Submit an application with the candidate's details + CV/attachments as multipart.
   * HttpClient sets the multipart boundary automatically for FormData; the interceptor
   * never overrides Content-Type, so the boundary is preserved.
   */
  apply(
    token: string,
    fields: {
      candidate_name: string;
      candidate_email: string;
      candidate_phone?: string;
      linkedin_url?: string;
      portfolio_url?: string;
      experience_years?: number;
      cover_note?: string;
    },
    files: File[],
  ): Observable<ApplyAcknowledgement> {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        form.append(key, String(value));
      }
    });
    files.forEach((file) => form.append('cv', file, file.name));
    return this.api.post<ApplyAcknowledgement>(API_ENDPOINTS.careers.apply(token), form);
  }
}
