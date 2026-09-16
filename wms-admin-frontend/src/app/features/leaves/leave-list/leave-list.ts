import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { UsersService } from '../../users/services/users.service';
import type { UserListItem } from '../../users/models/user-list-item.model';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalService } from '../../../core/services/modal.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';
import {
  mb,
  formatFileSize,
  type FileUploadConfig,
  type SelectedFile,
} from '../../../shared/components/file-upload/file-upload.model';
import {
  DataTableComponent,
  type BadgeVariant,
  type DataTableAction,
  type DataTableColumn,
  type DataTableDateRangeFilter,
  type DataTableFilter,
} from '../../../shared/components/data-table/data-table.component';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { createListState } from '../../../shared/list/list-state';
import { LeavesService } from '../services/leaves';
import {
  DAY_PORTION_LABELS,
  LEAVE_DAY_PORTIONS,
  LEAVE_PERMISSIONS,
  LEAVE_STATUSES,
  STATUS_LABELS,
  type LeaveBalance,
  type LeaveDayPortion,
  type LeaveFile,
  type LeaveRequest,
  type LeaveSaveAction,
  type LeaveStatus,
  type LeaveType,
} from '../models/leave.model';

/** Which content modal is currently open on this page. */
type OpenModal = 'create' | 'edit' | 'decision' | 'view' | 'type' | 'allocate' | null;

/**
 * Leave / Time Off list page.
 *
 * Visibility is scoped server-side (a normal user only sees their own requests; an
 * approver sees the whole org). This page makes the AVAILABLE ACTIONS role/status
 * aware for UX only — the backend re-enforces every rule (paid-balance checks,
 * owner-only edits, approver-only decisions, allocator-only admin). Actions open
 * reusable modals; withdraw/cancel/delete use the shared confirmation.
 */
@Component({
  selector: 'app-leave-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    FileUploadComponent,
    DataTableComponent,
  ],
  templateUrl: './leave-list.html',
  styleUrl: './leave-list.scss',
})
export class LeaveList {
  private readonly fb = inject(FormBuilder);
  private readonly leaves = inject(LeavesService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly users = inject(UsersService);
  private readonly destroyRef = inject(DestroyRef);

  // ---- Allocate user picker (searchable; scoped server-side by the caller's role:
  // org_admin sees their org, super_admin sees all users). Mirrors the ticket
  // assignee typeahead. Only active users are offered.
  /** The user chosen in the picker (drives the allocateForm.user uuid on submit). */
  protected readonly selectedUser = signal<UserListItem | null>(null);
  /** Current page of matching users (server-searched, capped small). */
  protected readonly userResults = signal<UserListItem[]>([]);
  protected readonly userSearch = signal('');
  protected readonly userSearchLoading = signal(false);
  /** True when more matches exist than the page shows (prompt to refine). */
  protected readonly userHasMore = signal(false);
  private readonly userSearch$ = new Subject<string>();

  protected readonly statusOptions = LEAVE_STATUSES;
  protected readonly dayPortionOptions = LEAVE_DAY_PORTIONS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly dayPortionLabels = DAY_PORTION_LABELS;

  // ---- Role capabilities (UX gating) ----
  protected readonly canCreate = computed(() => this.auth.hasPermission(LEAVE_PERMISSIONS.create));
  /** Approver = can approve/reject/cancel; also unlocks org-wide visibility UX. */
  protected readonly isApprover = computed(() => this.auth.hasPermission(LEAVE_PERMISSIONS.approve));
  protected readonly canDelete = computed(() => this.auth.hasPermission(LEAVE_PERMISSIONS.delete));
  /** Allocator = can manage leave types and allocate balances. */
  protected readonly isAllocator = computed(() =>
    this.auth.hasPermission(LEAVE_PERMISSIONS.allocate),
  );
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');

  // ---- Reference data ----
  /** Active leave types for the dropdowns (loaded once). */
  protected readonly leaveTypes = signal<LeaveType[]>([]);
  /** The caller's own balances (shown in the summary panel). */
  protected readonly myBalances = signal<LeaveBalance[]>([]);
  protected readonly balancesYear = signal<number>(new Date().getFullYear());

  // ---- Modal state ----
  protected readonly openModal = signal<OpenModal>(null);
  /** The request a row action is operating on (null for create). */
  protected readonly activeLeave = signal<LeaveRequest | null>(null);

  protected readonly list = createListState<LeaveRequest>(
    (query) => this.leaves.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<LeaveRequest>> = [
    { key: 'leave_number', label: 'Reference', value: (l) => l.leave_number, tone: 'code' },
    { key: 'applicant', label: 'Applicant', value: (l) => this.userName(l.applicant) },
    { key: 'leave_type', label: 'Type', value: (l) => l.leave_type?.name ?? '—' },
    {
      key: 'start_date',
      label: 'From',
      sortable: true,
      value: (l) => this.formatDate(l.start_date),
    },
    {
      key: 'end_date',
      label: 'To',
      sortable: true,
      value: (l) => this.formatDate(l.end_date),
    },
    { key: 'total_days', label: 'Days', sortable: true, value: (l) => String(l.total_days), tone: 'code' },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (l) => this.statusLabels[l.status],
      badge: (l) => ({
        label: this.statusLabels[l.status],
        variant: this.statusVariant(l.status),
        dot: true,
      }),
    },
  ];

  /** Map a status to a semantic pill color. */
  private statusVariant(status: LeaveStatus): BadgeVariant {
    switch (status) {
      case 'draft':
        return 'neutral';
      case 'submitted':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'withdrawn':
      case 'cancelled':
        return 'info';
      default:
        return 'neutral';
    }
  }

  protected readonly filters = computed<ReadonlyArray<DataTableFilter>>(() => [
    {
      key: 'status',
      label: 'Status',
      options: [
        { label: 'All statuses', value: '' },
        ...LEAVE_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'leave_type',
      label: 'Type',
      options: [
        { label: 'All types', value: '' },
        // We filter by the type's public uuid; the backend resolves it to the numeric
        // leave_type_id (ids are never exposed in DTOs).
        ...this.leaveTypes().map((t) => ({ label: t.name, value: t.uuid })),
      ],
    },
  ]);

  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    // Overlap semantics: matches any request whose date span intersects this window
    // (resolved in the leave service), not just requests that START in the window.
    label: 'Leave dates overlap',
    fromKey: 'start_date_from',
    toKey: 'start_date_to',
  };

  /** Row actions, filtered by capability + per-row policy (mirrors backend). */
  protected readonly actions = computed<ReadonlyArray<DataTableAction<LeaveRequest>>>(() => {
    const acts: DataTableAction<LeaveRequest>[] = [{ id: 'view', label: 'View', icon: 'view' }];

    // Owner can edit a draft or a rejected request.
    acts.push({
      id: 'edit',
      label: 'Edit',
      icon: 'edit',
      isDisabled: (l) => !this.canEdit(l),
      disabledLabel: () => 'Only draft or rejected requests you own can be edited',
    });

    // Owner submits a draft/rejected request.
    acts.push({
      id: 'submit',
      label: 'Submit',
      icon: 'submit',
      isDisabled: (l) => !this.canSubmit(l),
      disabledLabel: () => 'Only draft or rejected requests you own can be submitted',
    });

    // Owner withdraws a pending request.
    acts.push({
      id: 'withdraw',
      label: 'Withdraw',
      icon: 'withdraw',
      isDisabled: (l) => !this.canWithdraw(l),
      disabledLabel: () => 'Only your submitted requests can be withdrawn',
    });

    // Approvers decide submitted requests.
    if (this.isApprover()) {
      acts.push({
        id: 'decision',
        label: 'Approve / Reject',
        icon: 'check',
        isDisabled: (l) => l.status !== 'submitted',
        disabledLabel: () => 'Only submitted requests can be decided',
      });
      acts.push({
        id: 'cancel',
        label: 'Cancel',
        icon: 'cancel',
        variant: 'danger',
        isDisabled: (l) => l.status !== 'submitted' && l.status !== 'approved',
        disabledLabel: () => 'Only submitted or approved requests can be cancelled',
      });
    }

    if (this.canDelete()) {
      acts.push({
        id: 'delete',
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
        isDisabled: (l) => !this.canDeleteRow(l),
        disabledLabel: () => 'Only draft or rejected requests can be deleted',
      });
    }
    return acts;
  });

  // ---- Forms ----
  protected readonly createForm = this.fb.nonNullable.group({
    leave_type: ['', [Validators.required]],
    start_date: ['', [Validators.required]],
    end_date: ['', [Validators.required]],
    day_portion: ['full' as LeaveDayPortion, [Validators.required]],
    reason: ['', [Validators.maxLength(2000)]],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    leave_type: ['', [Validators.required]],
    start_date: ['', [Validators.required]],
    end_date: ['', [Validators.required]],
    day_portion: ['full' as LeaveDayPortion, [Validators.required]],
    reason: ['', [Validators.maxLength(2000)]],
  });

  protected readonly decisionForm = this.fb.nonNullable.group({
    decision: ['approve' as 'approve' | 'reject', [Validators.required]],
    rejection_reason: ['', [Validators.maxLength(1000)]],
  });

  protected readonly typeForm = this.fb.nonNullable.group({
    key: ['', [Validators.required, Validators.maxLength(50)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    is_paid: [true, [Validators.required]],
    color: ['#2563eb', [Validators.maxLength(9)]],
  });

  protected readonly allocateForm = this.fb.nonNullable.group({
    user: ['', [Validators.required]],
    leave_type: ['', [Validators.required]],
    period_year: [new Date().getFullYear(), [Validators.required, Validators.min(2000)]],
    allocated: [null as number | null, [Validators.required, Validators.min(0)]],
  });

  /**
   * Attachment upload config for leave: docs/images/pdf/excel/csv, <= 5 MB each,
   * max 3 files (matches the backend allow-list). Optional — a medical certificate,
   * for example. The shared uploader is fully driven by this config.
   */
  protected readonly attachmentConfig: FileUploadConfig = {
    accept: ['image', 'pdf', 'excel', 'csv', 'doc'],
    maxSizeBytes: mb(5),
    maxFiles: 3,
  };
  /** Files picked in the active form (names sent on submit; bytes ignored for now). */
  protected readonly attachments = signal<SelectedFile[]>([]);

  /**
   * When a create-with-attachments flow has to create a DRAFT first (files need the
   * request id as their owner) but a later step fails, we remember that draft's uuid
   * here. The next attempt reuses/updates it instead of creating another draft — this
   * prevents orphan draft rows piling up on repeated submit failures.
   */
  private readonly pendingDraftUuid = signal<string | null>(null);

  /**
   * All rendered uploaders (create + edit). We clear their internal selection when a
   * form opens/closes, since the component owns its own state and resetting the
   * `attachments` signal alone does not empty the picker.
   */
  private readonly uploaders = viewChildren(FileUploadComponent);

  constructor() {
    this.list.init();
    this.loadLeaveTypes();
    this.loadMyBalances();
    this.wireUserSearch();
  }

  /** Empty the parent's tracked files AND every uploader's internal selection. */
  private clearAttachments(): void {
    this.attachments.set([]);
    this.uploaders().forEach((u) => u.reset());
  }

  /**
   * Debounced, switch-mapped user search for the allocate picker: only the latest
   * query's results win, and we never fetch the whole directory — just a small page of
   * matches. The backend scopes results to what the caller may see (own org / all).
   */
  private wireUserSearch(): void {
    this.userSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          this.userSearchLoading.set(true);
          return this.users.list({
            search: term || undefined,
            limit: 20,
            sortBy: 'first_name',
            sortDir: 'asc',
            filters: { status: 'active' },
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.userResults.set(res.data ?? []);
          this.userHasMore.set(
            res.meta?.strategy === 'offset' ? res.meta.total > res.data.length : false,
          );
          this.userSearchLoading.set(false);
        },
        error: () => {
          this.userSearchLoading.set(false);
          this.notify.error('Could not load users.');
        },
      });
  }

  /** Typeahead input handler for the allocate user picker. */
  protected onUserSearch(term: string): void {
    this.userSearch.set(term);
    this.userSearch$.next(term.trim());
  }

  /** Pick a user from the results (sets the form's uuid). */
  protected selectUser(user: UserListItem): void {
    this.selectedUser.set(user);
    this.allocateForm.controls.user.setValue(user.uuid);
  }

  // ---- Reference loaders ----
  private loadLeaveTypes(): void {
    this.leaves.listTypes().subscribe({
      next: (types) => this.leaveTypes.set(types),
    });
  }

  private loadMyBalances(): void {
    this.leaves.myBalances().subscribe({
      next: (res) => {
        this.balancesYear.set(res.period_year);
        this.myBalances.set(res.balances);
      },
    });
  }

  // ---- Per-row policy (mirrors backend) ----
  private isOwner(leave: LeaveRequest): boolean {
    return !!leave.applicant && leave.applicant.uuid === this.currentUserUuid();
  }

  private isEditableStatus(leave: LeaveRequest): boolean {
    return leave.status === 'draft' || leave.status === 'rejected';
  }

  private canEdit(leave: LeaveRequest): boolean {
    return this.isOwner(leave) && this.isEditableStatus(leave);
  }

  private canSubmit(leave: LeaveRequest): boolean {
    return this.isOwner(leave) && this.isEditableStatus(leave);
  }

  private canWithdraw(leave: LeaveRequest): boolean {
    return this.isOwner(leave) && leave.status === 'submitted';
  }

  private canDeleteRow(leave: LeaveRequest): boolean {
    // Approvers may delete any visible non-active request; owners only draft/rejected.
    const deletableStatus =
      leave.status !== 'submitted' && leave.status !== 'approved';
    if (this.isApprover()) return deletableStatus;
    return this.isOwner(leave) && this.isEditableStatus(leave);
  }

  protected userName(user: LeaveRequest['applicant']): string {
    return user ? `${user.first_name} ${user.last_name}` : '—';
  }

  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  // ---- Attachment presentation helpers (mirror the expenses page) ----

  /** Human-readable file size (e.g. "2.4 MB"), or '' when size is unknown. */
  protected fileSize(file: LeaveFile): string {
    return file.file_size ? formatFileSize(file.file_size) : '';
  }

  /**
   * A short kind key used to pick an icon + accent for a file, derived from its mime
   * type (falling back to the extension). Keeps the template declarative.
   */
  protected fileKind(file: LeaveFile): 'image' | 'pdf' | 'sheet' | 'doc' | 'file' {
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
  protected fileBadge(file: LeaveFile): string {
    return { image: 'IMG', pdf: 'PDF', sheet: 'XLS', doc: 'DOC', file: 'FILE' }[
      this.fileKind(file)
    ];
  }

  /** The raw File objects currently picked in the uploader. */
  private pickedFiles(): File[] {
    return this.attachments().map((f) => f.file);
  }

  /** Today as YYYY-MM-DD, used to prevent selecting past dates in the date inputs. */
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  /** "Clear all": wipe the search box + every filter (status, type, date range). */
  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  // ---- Open modals ----
  protected openCreate(): void {
    this.createForm.reset({
      leave_type: this.leaveTypes()[0]?.uuid ?? '',
      start_date: '',
      end_date: '',
      day_portion: 'full',
      reason: '',
    });
    this.clearAttachments();
    this.pendingDraftUuid.set(null);
    this.openModal.set('create');
  }

  protected openTypeModal(): void {
    this.typeForm.reset({ key: '', name: '', is_paid: true, color: '#2563eb' });
    this.openModal.set('type');
  }

  protected openAllocateModal(): void {
    this.allocateForm.reset({
      user: '',
      leave_type: this.leaveTypes()[0]?.uuid ?? '',
      period_year: new Date().getFullYear(),
      allocated: null,
    });
    // Reset the user picker and load an initial page of users to choose from.
    this.selectedUser.set(null);
    this.userSearch.set('');
    this.userResults.set([]);
    this.userHasMore.set(false);
    this.openModal.set('allocate');
    this.userSearch$.next('');
  }

  protected onAction(event: { actionId: string; row: LeaveRequest }): void {
    switch (event.actionId) {
      case 'view':
        this.openView(event.row);
        break;
      case 'edit':
        this.openEdit(event.row);
        break;
      case 'submit':
        void this.confirmSubmit(event.row);
        break;
      case 'withdraw':
        void this.confirmWithdraw(event.row);
        break;
      case 'decision':
        this.openDecision(event.row);
        break;
      case 'cancel':
        void this.confirmCancel(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  private openView(leave: LeaveRequest): void {
    this.activeLeave.set(leave);
    this.openModal.set('view');
  }

  private openEdit(leave: LeaveRequest): void {
    this.activeLeave.set(leave);
    this.editForm.reset({
      leave_type: leave.leave_type?.uuid ?? '',
      start_date: leave.start_date,
      end_date: leave.end_date,
      day_portion: leave.day_portion,
      reason: leave.reason ?? '',
    });
    this.clearAttachments();
    this.openModal.set('edit');
  }

  private openDecision(leave: LeaveRequest): void {
    this.activeLeave.set(leave);
    this.decisionForm.reset({ decision: 'approve', rejection_reason: '' });
    this.openModal.set('decision');
  }

  protected closeModal(): void {
    this.openModal.set(null);
    this.activeLeave.set(null);
    this.clearAttachments();
  }

  // ---- Submit handlers ----

  /**
   * Create flow. Two paths, chosen to avoid orphan draft rows on submit failures:
   *
   *  - No attachments: do it in ONE atomic backend call — create({ action }). When the
   *    user submits, the backend creates + submits (with the balance hold) inside a
   *    single transaction, so a failed submit persists NOTHING. Nothing to clean up.
   *
   *  - With attachments: files need the request id as their owner, so we must create a
   *    DRAFT first, then upload, then submit. If a step fails we REMEMBER that draft's
   *    uuid (pendingDraftUuid) and the next attempt UPDATES + re-submits that same
   *    draft instead of creating a new one — so retries never stack up extra drafts.
   */
  protected submitCreate(action: LeaveSaveAction): void {
    if (this.createForm.invalid) {
      markAllAsTouched(this.createForm);
      return;
    }
    const v = this.createForm.getRawValue();
    if (!this.validateRange(v.start_date, v.end_date)) return;
    const files = this.pickedFiles();
    const content = {
      leave_type: v.leave_type,
      start_date: v.start_date,
      end_date: v.end_date,
      day_portion: v.day_portion,
      reason: v.reason?.trim() || undefined,
    };

    // ── Simple path: no files AND no draft already created → single atomic create.
    // (If a draft was created on a previous attempt, we must reuse it below, even when
    // the picker is now empty, so we never leave/duplicate a draft.) ──
    if (files.length === 0 && !this.pendingDraftUuid()) {
      this.submitting.set(true);
      this.leaves.create({ action, ...content }).subscribe({
        next: () => {
          this.notify.success(action === 'submit' ? 'Leave request submitted.' : 'Draft saved.');
          this.finishMutation();
        },
        error: () => this.submitting.set(false),
      });
      return;
    }

    // ── Attachment path: create/reuse a single draft, upload, then optionally submit. ──
    const existingDraft = this.pendingDraftUuid();
    // Reuse the draft from a previous failed attempt (update it) instead of making a
    // new one; otherwise create the draft for the first time.
    const draft$ = existingDraft
      ? this.leaves.update(existingDraft, content).pipe(switchMap(() => of({ uuid: existingDraft })))
      : this.leaves.create({ action: 'draft', ...content });

    this.submitting.set(true);
    draft$
      .pipe(
        // Remember the draft immediately so a later failure reuses it, not recreates it.
        switchMap((leave) => {
          this.pendingDraftUuid.set(leave.uuid);
          // Upload only files still pending in the picker. After a successful upload we
          // clear the picker so that if a LATER step (submit) fails, the retry does NOT
          // re-upload the same files onto the draft (which would duplicate them).
          if (!files.length) return of(leave);
          return this.leaves.uploadAttachments(leave.uuid, files).pipe(
            switchMap(() => {
              this.clearAttachments();
              return of(leave);
            }),
          );
        }),
        switchMap((leave) =>
          action === 'submit' ? this.leaves.submit(leave.uuid) : of(leave),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success(action === 'submit' ? 'Leave request submitted.' : 'Draft saved.');
          this.finishMutation();
        },
        // Keep pendingDraftUuid so the retry reuses the same draft (no duplicate).
        error: () => this.submitting.set(false),
      });
  }

  /**
   * Edit flow: save content, upload any newly-picked files, then optionally resubmit.
   * Mirrors expenses — content update and submit are discrete steps so files always
   * exist on the request before it is submitted.
   */
  protected submitEdit(action: LeaveSaveAction): void {
    const leave = this.activeLeave();
    if (!leave) return;
    if (this.editForm.invalid) {
      markAllAsTouched(this.editForm);
      return;
    }
    const v = this.editForm.getRawValue();
    if (!this.validateRange(v.start_date, v.end_date)) return;
    const files = this.pickedFiles();

    this.submitting.set(true);
    this.leaves
      .update(leave.uuid, {
        // Save content only; the submit is done as a discrete step after files upload.
        leave_type: v.leave_type,
        start_date: v.start_date,
        end_date: v.end_date,
        day_portion: v.day_portion,
        reason: v.reason?.trim() || undefined,
      })
      .pipe(
        switchMap((updated) =>
          files.length
            ? this.leaves.uploadAttachments(leave.uuid, files).pipe(switchMap(() => of(updated)))
            : of(updated),
        ),
        switchMap((updated) =>
          action === 'submit' ? this.leaves.submit(leave.uuid) : of(updated),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success(
            action === 'submit'
              ? `Request ${leave.leave_number} submitted.`
              : `Request ${leave.leave_number} updated.`,
          );
          this.finishMutation();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Delete one already-uploaded file from the active request (in the edit modal). */
  protected removeExistingAttachment(attachmentUuid: string): void {
    const leave = this.activeLeave();
    if (!leave) return;
    this.leaves.deleteAttachment(leave.uuid, attachmentUuid).subscribe({
      next: () => {
        // Reflect the removal in the open modal without a full reload.
        this.activeLeave.set({
          ...leave,
          leave_attachments: (leave.leave_attachments ?? []).filter(
            (a) => a.uuid !== attachmentUuid,
          ),
        });
        this.notify.success('Attachment removed.');
        this.list.reload();
      },
    });
  }

  /** Approver approves or rejects the active submitted request. */
  protected submitDecision(): void {
    const leave = this.activeLeave();
    if (!leave) return;
    const { decision, rejection_reason } = this.decisionForm.getRawValue();

    if (decision === 'reject' && !rejection_reason.trim()) {
      this.decisionForm.controls.rejection_reason.setErrors({ required: true });
      markAllAsTouched(this.decisionForm);
      return;
    }

    this.submitting.set(true);
    this.leaves
      .decide(leave.uuid, {
        decision,
        rejection_reason: decision === 'reject' ? rejection_reason.trim() : undefined,
      })
      .subscribe({
        next: () => {
          this.notify.success(
            decision === 'approve'
              ? `Request ${leave.leave_number} approved.`
              : `Request ${leave.leave_number} rejected.`,
          );
          this.finishMutation();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Allocator creates a new leave type. */
  protected submitType(): void {
    if (this.typeForm.invalid) {
      markAllAsTouched(this.typeForm);
      return;
    }
    const v = this.typeForm.getRawValue();
    this.submitting.set(true);
    this.leaves
      .createType({
        key: v.key.trim().toLowerCase(),
        name: v.name.trim(),
        is_paid: v.is_paid,
        color: v.color?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.notify.success('Leave type created.');
          this.submitting.set(false);
          this.closeModal();
          this.loadLeaveTypes();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Allocator allocates/sets a user's balance. */
  protected submitAllocate(): void {
    if (this.allocateForm.invalid) {
      markAllAsTouched(this.allocateForm);
      return;
    }
    const v = this.allocateForm.getRawValue();
    this.submitting.set(true);
    this.leaves
      .allocateBalance({
        user: v.user.trim(),
        leave_type: v.leave_type,
        period_year: Number(v.period_year),
        allocated: Number(v.allocated),
      })
      .subscribe({
        next: () => {
          this.notify.success('Leave balance updated.');
          this.submitting.set(false);
          this.closeModal();
          this.loadMyBalances();
        },
        error: () => this.submitting.set(false),
      });
  }

  // ---- Confirmed actions ----

  private async confirmSubmit(leave: LeaveRequest): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Submit leave request',
      message: `Submit request ${leave.leave_number} for approval? Paid leave will be checked against your balance.`,
      confirmText: 'Submit',
    });
    if (!confirmed) return;
    this.leaves.submit(leave.uuid).subscribe({
      next: () => {
        this.notify.success(`Request ${leave.leave_number} submitted.`);
        this.finishMutation();
      },
    });
  }

  private async confirmWithdraw(leave: LeaveRequest): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Withdraw leave request',
      message: `Withdraw request ${leave.leave_number}? Any held balance will be released.`,
      confirmText: 'Withdraw',
    });
    if (!confirmed) return;
    this.leaves.withdraw(leave.uuid).subscribe({
      next: () => {
        this.notify.success(`Request ${leave.leave_number} withdrawn.`);
        this.finishMutation();
      },
    });
  }

  private async confirmCancel(leave: LeaveRequest): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Cancel leave request',
      message: `Cancel request ${leave.leave_number}? Held or used balance will be released.`,
      confirmText: 'Cancel request',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.leaves.cancel(leave.uuid).subscribe({
      next: () => {
        this.notify.success(`Request ${leave.leave_number} cancelled.`);
        this.finishMutation();
      },
    });
  }

  private async confirmDelete(leave: LeaveRequest): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete leave request',
      message: `Delete request ${leave.leave_number}? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.leaves.remove(leave.uuid).subscribe({
      next: () => {
        this.notify.success(`Request ${leave.leave_number} deleted.`);
        this.list.reload();
      },
    });
  }

  /** Client-side date guard (backend re-enforces): no past dates, end >= start. */
  private validateRange(start: string, end: string): boolean {
    if (start < this.today) {
      this.notify.error('Leave cannot start in the past.');
      return false;
    }
    if (end < start) {
      this.notify.error('The end date must be on or after the start date.');
      return false;
    }
    return true;
  }

  /** Shared post-mutation cleanup: close modal, reload list + balances. */
  private finishMutation(): void {
    this.submitting.set(false);
    this.pendingDraftUuid.set(null);
    this.closeModal();
    this.list.reload();
    this.loadMyBalances();
  }
}
