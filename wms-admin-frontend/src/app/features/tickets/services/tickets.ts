import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ListQuery, PaginatedResult } from '../../../core/models/pagination.model';
import type {
  Ticket,
  TicketFile,
  TicketUser,
  CreateTicketRequest,
  UpdateTicketRequest,
  TicketStatus,
} from '../models/ticket.model';

/**
 * Data access for the tickets feature.
 *
 * The backend enforces the real multi-tenant + per-role policy (visibility,
 * own-vs-any updates, assigned-only status changes). This service just maps calls
 * to endpoints; every list request flows through the shared paginated ApiService.list.
 */
@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly api = inject(ApiService);

  /** Paginated, searchable, sortable, filterable list of visible tickets. */
  list(query: ListQuery): Observable<PaginatedResult<Ticket>> {
    return this.api.list<Ticket>(API_ENDPOINTS.tickets.root, query);
  }

  getByUuid(uuid: string): Observable<Ticket> {
    return this.api.get<Ticket>(API_ENDPOINTS.tickets.byUuid(uuid));
  }

  create(payload: CreateTicketRequest): Observable<Ticket> {
    return this.api.post<Ticket>(API_ENDPOINTS.tickets.root, payload);
  }

  update(uuid: string, payload: UpdateTicketRequest): Observable<Ticket> {
    return this.api.put<Ticket>(API_ENDPOINTS.tickets.byUuid(uuid), payload);
  }

  /** Assign a ticket to a user (by uuid) or unassign by passing null. */
  setAssignee(uuid: string, assignedTo: string | null): Observable<Ticket> {
    return this.api.patch<Ticket>(API_ENDPOINTS.tickets.assignee(uuid), {
      assigned_to: assignedTo,
    });
  }

  updateStatus(uuid: string, status: TicketStatus): Observable<Ticket> {
    return this.api.patch<Ticket>(API_ENDPOINTS.tickets.status(uuid), { status });
  }

  remove(uuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.tickets.byUuid(uuid));
  }

  // ── Attachments (real file uploads) ────────────────────────────────────────

  /**
   * Upload one or more real files to a ticket as multipart/form-data.
   *
   * We build a FormData and post it through ApiService. Angular's HttpClient sets the
   * correct `multipart/form-data; boundary=...` header automatically for FormData, and
   * the auth interceptor only adds the Bearer token (it never sets Content-Type), so
   * the multipart boundary is preserved. Returns the created attachment rows.
   */
  uploadAttachments(uuid: string, files: File[]): Observable<TicketFile[]> {
    const form = new FormData();
    // The backend uses uploadFiles.any(), so the field name is free-form; the ticket
    // owner is resolved server-side from the :uuid, never sent in the body.
    files.forEach((file) => form.append('files', file, file.name));
    return this.api.post<TicketFile[]>(API_ENDPOINTS.tickets.attachments(uuid), form);
  }

  /** List a ticket's uploaded files. */
  listAttachments(uuid: string): Observable<TicketFile[]> {
    return this.api.get<TicketFile[]>(API_ENDPOINTS.tickets.attachments(uuid));
  }

  /** Delete one uploaded file from a ticket. */
  deleteAttachment(uuid: string, attachmentUuid: string): Observable<null> {
    return this.api.delete<null>(API_ENDPOINTS.tickets.attachment(uuid, attachmentUuid));
  }

  /**
   * Fetch users who can be assigned to a SPECIFIC ticket.
   *
   * This hits the ticket-scoped endpoint, so results are limited to the ticket's own
   * organization (correct even for super_admin) and are searchable + paginated on the
   * server — so it scales to millions of users. Pass a `search` term for typeahead;
   * never load the whole directory into the client.
   */
  assignableUsers(
    ticketUuid: string,
    query: ListQuery = { limit: 20 },
  ): Observable<PaginatedResult<TicketUser>> {
    return this.api.list<TicketUser>(API_ENDPOINTS.tickets.assignableUsers(ticketUuid), query);
  }
}
