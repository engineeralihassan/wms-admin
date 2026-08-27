import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type { UserListItem } from '../models/user-list-item.model';

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

  /** Fetch a single user by uuid. */
  getByUuid(uuid: string): Observable<UserListItem> {
    return this.api.get<UserListItem>(API_ENDPOINTS.users.byUuid(uuid));
  }
}
