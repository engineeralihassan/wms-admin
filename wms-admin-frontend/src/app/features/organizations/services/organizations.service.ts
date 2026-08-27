import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type { Organization, CreateOrganizationRequest } from '../models/organization.model';

interface CreateOrganizationResponse {
  organization: Organization;
  admin: { id: number; uuid: string; email: string; first_name: string; last_name: string };
}

/** Data access for the organizations feature (super_admin only). */
@Injectable({ providedIn: 'root' })
export class OrganizationsService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable list of organizations. */
  list(query: ListQuery): Observable<PaginatedResult<Organization>> {
    return this.api.list<Organization>(API_ENDPOINTS.organizations.root, query);
  }

  create(payload: CreateOrganizationRequest): Observable<CreateOrganizationResponse> {
    return this.api.post<CreateOrganizationResponse>(API_ENDPOINTS.organizations.root, payload);
  }
}
