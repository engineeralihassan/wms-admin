import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalService } from '../../../core/services/modal.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';
import { mb, formatFileSize, type FileUploadConfig, type SelectedFile } from '../../../shared/components/file-upload/file-upload.model';
import {
  DataTableComponent,
  type BadgeVariant,
  type DataTableAction,
  type DataTableColumn,
  type DataTableDateRangeFilter,
  type DataTableFilter,
} from '../../../shared/components/data-table/data-table.component';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { createListState } from '../../../shared/list/list-state';
import { TicketsService } from '../services/tickets';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TICKET_PERMISSIONS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type Ticket,
  type TicketFile,
  type TicketUser,
  type TicketPriority,
  type TicketStatus,
} from '../models/ticket.model';

/** Which content modal is currently open on this page. */
type OpenModal = 'create' | 'edit' | 'status' | 'assign' | 'view' | null;

/**
 * Tickets list page.
 *
 * Visibility is scoped server-side; this page makes the AVAILABLE ACTIONS role-aware
 * (UX only — the backend re-enforces everything). Actions open reusable modals:
 *   - create/edit/status/assign -> declarative <app-modal> hosting a small form
 *   - delete                    -> ModalService.confirm() (shared confirmation)
 */
@Component({
  selector: 'app-ticket-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    FileUploadComponent,
    DataTableComponent,
  ],
  templateUrl: './ticket-list.html',
  styleUrl: './ticket-list.scss',
})
export class TicketList {
  private readonly fb = inject(FormBuilder);
  private readonly tickets = inject(TicketsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);

  protected readonly priorityOptions = TICKET_PRIORITIES;
  protected readonly statusOptions = TICKET_STATUSES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  // ---- Role capabilities (UX gating) ----
  protected readonly canCreate = computed(() => this.auth.hasPermission(TICKET_PERMISSIONS.create));
  /** Org manager = can assign; this also unlocks org-wide edit/status/delete UX. */
  protected readonly isManager = computed(() => this.auth.hasPermission(TICKET_PERMISSIONS.assign));
  protected readonly canDelete = computed(() => this.auth.hasPermission(TICKET_PERMISSIONS.delete));
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');

  // ---- Modal state ----
  protected readonly openModal = signal<OpenModal>(null);
  /** The ticket a row action is operating on (null for create). */
  protected readonly activeTicket = signal<Ticket | null>(null);

  // ---- Assignee typeahead (scoped to the active ticket's organization) ----
  /** Current page of matching users (server-searched, capped small). */
  protected readonly assignableUsers = signal<TicketUser[]>([]);
  protected readonly assigneeSearch = signal('');
  protected readonly assigneeLoading = signal(false);
  /** True when more matches exist than the page shows (prompt to refine search). */
  protected readonly assigneeHasMore = signal(false);
  /** The user picked in the picker (null = unassign). */
  protected readonly selectedAssignee = signal<TicketUser | null>(null);
  private readonly assigneeSearch$ = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);

  protected readonly list = createListState<Ticket>(
    (query) => this.tickets.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<Ticket>> = [
    { key: 'ticket_number', label: 'Ticket', sortable: true, value: (t) => t.ticket_number, tone: 'code' },
    { key: 'subject', label: 'Subject', value: (t) => t.subject },
    { key: 'created_by', label: 'Submitted by', value: (t) => this.userName(t.created_by) },
    {
      key: 'assigned_to',
      label: 'Assignee',
      value: (t) => this.userName(t.assigned_to),
      badge: (t) =>
        t.assigned_to
          ? { label: this.userName(t.assigned_to), variant: 'info' }
          : { label: 'Unassigned', variant: 'neutral' },
    },
    {
      key: 'priority',
      label: 'Priority',
      sortable: true,
      value: (t) => this.priorityLabels[t.priority],
      badge: (t) => ({ label: this.priorityLabels[t.priority], variant: this.priorityVariant(t.priority) }),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (t) => this.statusLabels[t.status],
      badge: (t) => ({ label: this.statusLabels[t.status], variant: this.statusVariant(t.status), dot: true }),
    },
    { key: 'created_at', label: 'Created', sortable: true, value: (t) => this.formatDate(t.created_at), tone: 'muted' },
  ];

  /** Map a priority to a semantic pill color. */
  private priorityVariant(priority: TicketPriority): BadgeVariant {
    switch (priority) {
      case 'urgent': return 'danger';
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'neutral';
      default: return 'neutral';
    }
  }

  /** Map a status to a semantic pill color. */
  private statusVariant(status: TicketStatus): BadgeVariant {
    switch (status) {
      case 'open': return 'info';
      case 'in_progress': return 'warning';
      case 'resolved': return 'success';
      case 'closed': return 'neutral';
      case 'cancelled': return 'danger';
      default: return 'neutral';
    }
  }

  protected readonly filters: ReadonlyArray<DataTableFilter> = [
    {
      key: 'status',
      label: 'Status',
      options: [
        { label: 'All statuses', value: '' },
        ...TICKET_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      options: [
        { label: 'All priorities', value: '' },
        ...TICKET_PRIORITIES.map((p) => ({ label: PRIORITY_LABELS[p], value: p })),
      ],
    },
  ];

  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Created date',
    fromKey: 'created_at_from',
    toKey: 'created_at_to',
  };

  /** Row actions, filtered by capability + per-row policy. */
  protected readonly actions = computed<ReadonlyArray<DataTableAction<Ticket>>>(() => {
    const acts: DataTableAction<Ticket>[] = [
      { id: 'view', label: 'View', icon: 'view' },
      {
        id: 'edit',
        label: 'Edit',
        icon: 'edit',
        isDisabled: (t) => !this.canEdit(t),
        disabledLabel: () => 'You can only edit your own ticket',
      },
      {
        id: 'status',
        label: 'Change status',
        icon: 'status',
        isDisabled: (t) => !this.canChangeStatus(t),
        disabledLabel: () => 'You can only change the status of tickets assigned to you',
      },
    ];
    if (this.isManager()) {
      acts.push({ id: 'assign', label: 'Assign / Unassign', icon: 'assign' });
    }
    if (this.canDelete()) {
      acts.push({ id: 'delete', label: 'Delete', icon: 'delete', variant: 'danger' });
    }
    return acts;
  });

  // ---- Forms ----
  protected readonly createForm = this.fb.nonNullable.group({
    subject: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
    description: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(5000)]],
    priority: ['medium' as TicketPriority, [Validators.required]],
  });

  /**
   * Attachment upload config for tickets: docs/images/pdf/excel/csv, <= 3 MB each,
   * max 3 files. This is the ONLY place the ticket rules live — the shared uploader
   * is fully driven by it, so other features declare their own config the same way.
   */
  protected readonly attachmentConfig: FileUploadConfig = {
    accept: ['image', 'pdf', 'excel', 'csv', 'doc'],
    maxSizeBytes: mb(3),
    maxFiles: 3,
  };
  /** Files picked in the create form (names sent on submit; bytes ignored for now). */
  protected readonly attachments = signal<SelectedFile[]>([]);

  /**
   * All rendered uploaders. We clear their internal selection when a form opens/closes,
   * since the component owns its own state and resetting the `attachments` signal alone
   * does not empty the picker.
   */
  private readonly uploaders = viewChildren(FileUploadComponent);

  protected readonly editForm = this.fb.nonNullable.group({
    subject: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
    description: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(5000)]],
    priority: ['medium' as TicketPriority, [Validators.required]],
  });

  protected readonly statusForm = this.fb.nonNullable.group({
    status: ['open' as TicketStatus, [Validators.required]],
  });

  constructor() {
    this.list.init();

    // Debounced, switch-mapped assignee search: only the latest query's results win,
    // and we never fetch the whole directory — just a small page of matches.
    this.assigneeSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const ticket = this.activeTicket();
          this.assigneeLoading.set(true);
          return this.tickets.assignableUsers(ticket!.uuid, {
            search: term || undefined,
            limit: 20,
            sortBy: 'first_name',
            sortDir: 'asc',
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.assignableUsers.set(res.data ?? []);
          this.assigneeHasMore.set(
            res.meta?.strategy === 'offset' ? res.meta.total > res.data.length : false,
          );
          this.assigneeLoading.set(false);
        },
        error: () => {
          this.assigneeLoading.set(false);
          this.notify.error('Could not load assignable users.');
        },
      });
  }

  /** Empty the parent's tracked files AND every uploader's internal selection. */
  private clearAttachments(): void {
    this.attachments.set([]);
    this.uploaders().forEach((u) => u.reset());
  }

  // ---- Per-row policy (mirrors backend) ----
  private canEdit(ticket: Ticket): boolean {
    if (this.isManager()) return true;
    return !!ticket.created_by && ticket.created_by.uuid === this.currentUserUuid();
  }

  private canChangeStatus(ticket: Ticket): boolean {
    if (this.isManager()) return true;
    return !!ticket.assigned_to && ticket.assigned_to.uuid === this.currentUserUuid();
  }

  protected userName(user: Ticket['created_by']): string {
    return user ? `${user.first_name} ${user.last_name}` : 'Unassigned';
  }

  protected formatDate(value?: string): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  // ---- Attachment presentation helpers (mirror the expenses page) ----

  /** Human-readable file size (e.g. "2.4 MB"), or '' when size is unknown. */
  protected fileSize(file: TicketFile): string {
    return file.file_size ? formatFileSize(file.file_size) : '';
  }

  /**
   * A short kind key used to pick an icon + accent for a file, derived from its mime
   * type (falling back to the extension). Keeps the template declarative.
   */
  protected fileKind(file: TicketFile): 'image' | 'pdf' | 'sheet' | 'doc' | 'file' {
    const mime = (file.file_mime || '').toLowerCase();
    const name = (file.file_name || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (mime.includes('sheet') || mime.includes('excel') || /\.(xlsx?|csv)$/.test(name))
      return 'sheet';
    if (mime.includes('word') || /\.(docx?|txt)$/.test(name)) return 'doc';
    return 'file';
  }

  /** The short label shown on the file badge (e.g. "PDF", "IMG"). */
  protected fileBadge(file: TicketFile): string {
    return { image: 'IMG', pdf: 'PDF', sheet: 'XLS', doc: 'DOC', file: 'FILE' }[
      this.fileKind(file)
    ];
  }

  /** The raw File objects currently picked in the uploader. */
  private pickedFiles(): File[] {
    return this.attachments().map((f) => f.file);
  }

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  /** "Clear all": wipe the search box + every filter. */
  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  // ---- Open modals ----
  protected openCreate(): void {
    this.createForm.reset({ priority: 'medium' });
    this.clearAttachments();
    this.openModal.set('create');
  }

  protected onAction(event: { actionId: string; row: Ticket }): void {
    switch (event.actionId) {
      case 'view':
        this.openView(event.row);
        break;
      case 'edit':
        this.openEdit(event.row);
        break;
      case 'status':
        this.openStatus(event.row);
        break;
      case 'assign':
        this.openAssign(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  private openView(ticket: Ticket): void {
    this.activeTicket.set(ticket);
    this.openModal.set('view');
  }

  private openEdit(ticket: Ticket): void {
    this.activeTicket.set(ticket);
    this.editForm.reset({
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
    });
    // Start with an empty picker; existing attachments are shown separately.
    this.clearAttachments();
    this.openModal.set('edit');
  }

  private openStatus(ticket: Ticket): void {
    this.activeTicket.set(ticket);
    this.statusForm.reset({ status: ticket.status });
    this.openModal.set('status');
  }

  private openAssign(ticket: Ticket): void {
    this.activeTicket.set(ticket);
    // Pre-select the current assignee (shown as a chip); start with a blank search
    // that loads the first page of the ticket's org members.
    this.selectedAssignee.set(ticket.assigned_to ?? null);
    this.assigneeSearch.set('');
    this.assignableUsers.set([]);
    this.assigneeHasMore.set(false);
    this.openModal.set('assign');
    this.assigneeSearch$.next('');
  }

  /** Typeahead input handler — server searches within the ticket's organization. */
  protected onAssigneeSearch(term: string): void {
    this.assigneeSearch.set(term);
    this.assigneeSearch$.next(term.trim());
  }

  /** Pick a user (or null to unassign) from the results. */
  protected selectAssignee(user: TicketUser | null): void {
    this.selectedAssignee.set(user);
  }

  protected closeModal(): void {
    this.openModal.set(null);
    this.activeTicket.set(null);
    this.clearAttachments();
  }

  // ---- Submit handlers (action logic lives here, in the parent) ----
  protected submitCreate(): void {
    if (this.createForm.invalid) {
      markAllAsTouched(this.createForm);
      return;
    }
    const v = this.createForm.getRawValue();
    // Files are real now (bytes in object storage), mirroring expenses/leave: create
    // the ticket first (files need its id as their owner), then upload any picked files.
    const files = this.pickedFiles();
    this.submitting.set(true);
    this.tickets
      .create({
        subject: v.subject.trim(),
        description: v.description.trim(),
        priority: v.priority,
      })
      .pipe(
        switchMap((ticket) =>
          files.length
            ? this.tickets.uploadAttachments(ticket.uuid, files).pipe(switchMap(() => of(ticket)))
            : of(ticket),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success('Ticket created.');
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  protected submitEdit(): void {
    const ticket = this.activeTicket();
    if (!ticket) return;
    if (this.editForm.invalid) {
      markAllAsTouched(this.editForm);
      return;
    }
    const v = this.editForm.getRawValue();
    const files = this.pickedFiles();
    this.submitting.set(true);
    this.tickets
      .update(ticket.uuid, {
        subject: v.subject.trim(),
        description: v.description.trim(),
        priority: v.priority,
      })
      .pipe(
        switchMap((updated) =>
          files.length
            ? this.tickets.uploadAttachments(ticket.uuid, files).pipe(switchMap(() => of(updated)))
            : of(updated),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success(`Ticket ${ticket.ticket_number} updated.`);
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Delete one already-uploaded file from the active ticket (in the edit modal). */
  protected removeExistingAttachment(attachmentUuid: string): void {
    const ticket = this.activeTicket();
    if (!ticket) return;
    this.tickets.deleteAttachment(ticket.uuid, attachmentUuid).subscribe({
      next: () => {
        // Reflect the removal in the open modal without a full reload.
        this.activeTicket.set({
          ...ticket,
          ticket_attachments: (ticket.ticket_attachments ?? []).filter(
            (a) => a.uuid !== attachmentUuid,
          ),
        });
        this.notify.success('Attachment removed.');
        this.list.reload();
      },
    });
  }

  protected submitStatus(): void {
    const ticket = this.activeTicket();
    if (!ticket) return;
    const { status } = this.statusForm.getRawValue();
    this.submitting.set(true);
    this.tickets.updateStatus(ticket.uuid, status).subscribe({
      next: () => {
        this.notify.success(`Ticket ${ticket.ticket_number} moved to ${STATUS_LABELS[status]}.`);
        this.submitting.set(false);
        this.closeModal();
        this.list.reload();
      },
      error: () => this.submitting.set(false),
    });
  }

  protected submitAssign(): void {
    const ticket = this.activeTicket();
    if (!ticket) return;
    const assigneeUuid = this.selectedAssignee()?.uuid ?? null;
    this.submitting.set(true);
    this.tickets.setAssignee(ticket.uuid, assigneeUuid).subscribe({
      next: () => {
        this.notify.success(
          assigneeUuid
            ? `Ticket ${ticket.ticket_number} assigned.`
            : `Ticket ${ticket.ticket_number} unassigned.`,
        );
        this.submitting.set(false);
        this.closeModal();
        this.list.reload();
      },
      error: () => this.submitting.set(false),
    });
  }

  /** Delete uses the shared confirmation modal; the action runs here on confirm. */
  private async confirmDelete(ticket: Ticket): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete ticket',
      message: `Delete ticket ${ticket.ticket_number}? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.tickets.remove(ticket.uuid).subscribe({
      next: () => {
        this.notify.success(`Ticket ${ticket.ticket_number} deleted.`);
        this.list.reload();
      },
    });
  }
}
