import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type {
  MyProfileResponse,
  ProfileDocument,
  UpdateMyProfilePayload,
} from '../models/profile.model';

/**
 * Self-service profile data service.
 *
 * Backed entirely by the /auth/me/* endpoints, so a plain consultant needs only a
 * valid session (no user.* permission). The backend enforces the section/document
 * locks; this service just relays the calls.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly api = inject(ApiService);

  /** The caller's OWN full profile (identity + nested profile + section locks). */
  getMyProfile(): Observable<MyProfileResponse> {
    return this.api.get<MyProfileResponse>(API_ENDPOINTS.auth.myProfile);
  }

  /** Upsert the caller's OWN profile. Partial — only the sections provided are written. */
  updateMyProfile(payload: UpdateMyProfilePayload): Observable<MyProfileResponse> {
    return this.api.patch<MyProfileResponse>(API_ENDPOINTS.auth.myProfile, payload);
  }

  /** The caller's OWN document checklist (merged catalogue + uploaded rows). */
  getMyDocuments(): Observable<ProfileDocument[]> {
    return this.api.get<ProfileDocument[]>(API_ENDPOINTS.auth.myDocuments);
  }

  /**
   * Upload a document for a slot. Sends multipart/form-data with the binary `file`
   * part plus the slot metadata; the backend streams it to object storage. A locked
   * (verified) slot is rejected server-side with 409.
   */
  uploadMyDocument(
    docType: string,
    file: File,
    extra?: { expires_on?: string | null; note?: string | null },
  ): Observable<ProfileDocument> {
    const form = new FormData();
    form.append('doc_type', docType);
    form.append('file', file, file.name);
    if (extra?.expires_on) form.append('expires_on', extra.expires_on);
    if (extra?.note) form.append('note', extra.note);
    return this.api.post<ProfileDocument>(API_ENDPOINTS.auth.myDocuments, form);
  }
}
