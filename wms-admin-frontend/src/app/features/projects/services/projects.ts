import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  Project,
  ProjectMember,
  ProjectUser,
  ProjectMemberRole,
  CreateProjectRequest,
  UpdateProjectRequest,
  AddMembersRequest,
} from '../models/project.model';

/**
 * Data access for the projects feature.
 *
 * The backend enforces the real multi-tenant + per-role policy (org admins see all
 * their org's projects; members see only projects they're assigned to; same-org-only
 * member assignment). This service just maps calls to endpoints; every list request
 * flows through the shared paginated ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable, filterable list of visible projects. */
  list(query: ListQuery): Observable<PaginatedResult<Project>> {
    return this.api.list<Project>(API_ENDPOINTS.projects.root, query);
  }

  /** Projects the current user is a member of ("My Projects"). */
  listMine(query: ListQuery): Observable<PaginatedResult<Project>> {
    return this.api.list<Project>(API_ENDPOINTS.projects.mine, query);
  }

  getByUuid(uuid: string): Observable<Project> {
    return this.api.get<Project>(API_ENDPOINTS.projects.byUuid(uuid));
  }

  create(payload: CreateProjectRequest): Observable<Project> {
    return this.api.post<Project>(API_ENDPOINTS.projects.root, payload);
  }

  update(uuid: string, payload: UpdateProjectRequest): Observable<Project> {
    return this.api.put<Project>(API_ENDPOINTS.projects.byUuid(uuid), payload);
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.projects.byUuid(uuid));
  }

  /** List a project's members (server returns the full member set for the project). */
  members(uuid: string): Observable<ProjectMember[]> {
    return this.api.get<ProjectMember[]>(API_ENDPOINTS.projects.members(uuid));
  }

  /** Add one or more members to a project (manager only). */
  addMembers(uuid: string, payload: AddMembersRequest): Observable<ProjectMember[]> {
    return this.api.post<ProjectMember[]>(API_ENDPOINTS.projects.members(uuid), payload);
  }

  /** Change a member's role within the project (manager only). */
  updateMember(
    uuid: string,
    userUuid: string,
    memberRole: ProjectMemberRole,
  ): Observable<ProjectMember[]> {
    return this.api.patch<ProjectMember[]>(API_ENDPOINTS.projects.member(uuid, userUuid), {
      member_role: memberRole,
    });
  }

  /** Remove a member from a project (manager only). */
  removeMember(uuid: string, userUuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.projects.member(uuid, userUuid));
  }

  /**
   * Fetch org users who can be ADDED to a SPECIFIC project.
   *
   * This hits the project-scoped endpoint, so results are limited to the project's own
   * organization (correct even for super_admin), exclude users already on the project,
   * and are searchable + paginated on the server — so it scales to millions of users.
   * Pass a `search` term for typeahead; never load the whole directory into the client.
   */
  assignableUsers(
    projectUuid: string,
    query: ListQuery = { limit: 20 },
  ): Observable<PaginatedResult<ProjectUser>> {
    return this.api.list<ProjectUser>(
      API_ENDPOINTS.projects.assignableUsers(projectUuid),
      query,
    );
  }
}
