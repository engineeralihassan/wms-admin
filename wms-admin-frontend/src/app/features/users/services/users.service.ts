import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type { UserListItem } from '../models/user-list-item.model';
import type {
  CreateUserPayload,
  DocumentStatusPayload,
  SectionStatusPayload,
  UserDetail,
  UserDocument,
  UserProfile,
  VendorOption,
} from '../models/user.model';

/**
 * Users feature data service.
 * `list()` delegates to the shared paginated ApiService.list, so search/sort/paging
 * are handled uniformly. The backend enforces tenant + ownership scoping.
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable list of users visible to the caller. */
  list(query: ListQuery): Observable<PaginatedResult<UserListItem>> {
    return this.api.list<UserListItem>(API_ENDPOINTS.users.root, query);
  }

  /** Fetch a single user by uuid (compact list shape). */
  getByUuid(uuid: string): Observable<UserListItem> {
    return this.api.get<UserListItem>(API_ENDPOINTS.users.byUuid(uuid));
  }

  /** Fetch the FULL user detail (identity + nested profile + documents). */
  getDetail(uuid: string): Observable<UserDetail> {
    return this.api.get<UserDetail>(API_ENDPOINTS.users.byUuid(uuid));
  }

  /** Create a user (invited). Optionally seeds profile fields. */
  create(payload: CreateUserPayload): Observable<UserDetail> {
    return this.api.post<UserDetail>(API_ENDPOINTS.users.root, payload);
  }

  /** Vendors in the caller's org — for the C2C "select vendor" dropdown. */
  listVendors(): Observable<VendorOption[]> {
    return this.api.get<VendorOption[]>(API_ENDPOINTS.users.vendors);
  }

  /** Update identity fields (name). */
  update(uuid: string, patch: { first_name?: string; last_name?: string }): Observable<UserDetail> {
    return this.api.patch<UserDetail>(API_ENDPOINTS.users.byUuid(uuid), patch);
  }

  /** Upsert the rich profile (Work / Private / Contract / Settings tabs). */
  updateProfile(uuid: string, profile: UserProfile | Partial<UserProfile>): Observable<UserDetail> {
    return this.api.patch<UserDetail>(API_ENDPOINTS.users.profile(uuid), profile);
  }

  /** List a user's document checklist. */
  listDocuments(uuid: string): Observable<UserDocument[]> {
    return this.api.get<UserDocument[]>(API_ENDPOINTS.users.documents(uuid));
  }

  /** Record an uploaded document's metadata. */
  uploadDocument(uuid: string, doc: Partial<UserDocument> & { doc_type: string }): Observable<UserDocument> {
    return this.api.post<UserDocument>(API_ENDPOINTS.users.documents(uuid), doc);
  }

  /** Resend the activation invite for an invited user. */
  resendInvite(uuid: string): Observable<null> {
    return this.api.post<null>(API_ENDPOINTS.users.resendInvite(uuid), {});
  }

  /**
   * Admin review: approve / reject / unlock a single document.
   *  - 'verified'  => approved and LOCKED (user can no longer replace it)
   *  - 'rejected'  => rejected (user may re-upload)
   *  - 'uploaded'  => unlock a previously approved doc (user may re-upload)
   */
  setDocumentStatus(
    uuid: string,
    docUuid: string,
    payload: DocumentStatusPayload,
  ): Observable<UserDocument> {
    return this.api.patch<UserDocument>(
      API_ENDPOINTS.users.documentStatus(uuid, docUuid),
      payload,
    );
  }

  /**
   * Admin review: lock (verified) or unlock (unverified) a structured profile section
   * (bank_details / work_authorization / emergency_contact).
   */
  setProfileSection(uuid: string, payload: SectionStatusPayload): Observable<UserDetail> {
    return this.api.patch<UserDetail>(API_ENDPOINTS.users.profileSections(uuid), payload);
  }
}
