import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
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
import { ExpensesService } from '../services/expenses';
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_CURRENCIES,
  EXPENSE_PERMISSIONS,
  EXPENSE_STATUSES,
  STATUS_LABELS,
  type Expense,
  type ExpenseCategory,
  type ExpenseCurrency,
  type ExpenseFile,
  type ExpenseSaveAction,
  type ExpenseStatus,
} from '../models/expense.model';

/** Which content modal is currently open on this page. */
type OpenModal = 'create' | 'edit' | 'review' | 'view' | null;

/**
 * Expenses list page.
 *
 * Visibility is scoped server-side (a normal user only sees their own expenses; a
 * reviewer sees the whole org). This page makes the AVAILABLE ACTIONS role/status
 * aware for UX only — the backend re-enforces every rule. Actions open reusable
 * modals; delete uses the shared confirmation.
 */
@Component({
  selector: 'app-expense-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    FileUploadComponent,
    DataTableComponent,
  ],
  templateUrl: './expense-list.html',
  styleUrl: './expense-list.scss',
})
export class ExpenseList {
  private readonly fb = inject(FormBuilder);
  private readonly expenses = inject(ExpensesService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);

  protected readonly categoryOptions = EXPENSE_CATEGORIES;
  protected readonly statusOptions = EXPENSE_STATUSES;
  protected readonly currencyOptions = EXPENSE_CURRENCIES;
  protected readonly categoryLabels = CATEGORY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;

  // ---- Role capabilities (UX gating) ----
  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(EXPENSE_PERMISSIONS.create),
  );
  /** Reviewer = can approve/reject; this also unlocks org-wide visibility UX. */
  protected readonly isReviewer = computed(() =>
    this.auth.hasPermission(EXPENSE_PERMISSIONS.review),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(EXPENSE_PERMISSIONS.delete),
  );
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');

  // ---- Modal state ----
  protected readonly openModal = signal<OpenModal>(null);
  /** The expense a row action is operating on (null for create). */
  protected readonly activeExpense = signal<Expense | null>(null);
  /** Tracks whether create/edit should submit or just save a draft. */
  private readonly pendingAction = signal<ExpenseSaveAction>('draft');

  protected readonly list = createListState<Expense>(
    (query) => this.expenses.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<Expense>> = [
    { key: 'title', label: 'Title', value: (e) => e.title },
    {
      key: 'created_at',
      label: 'Submission Date',
      sortable: true,
      value: (e) => this.formatDate(e.submitted_at ?? e.created_at),
      tone: 'muted',
    },
    {
      key: 'expense_date',
      label: 'Expense Date',
      sortable: true,
      value: (e) => this.formatDate(e.expense_date),
    },
    {
      key: 'amount',
      label: 'Total Expense',
      sortable: true,
      value: (e) => this.formatMoney(e.amount, e.currency),
      tone: 'code',
    },
    { key: 'category', label: 'Category', value: (e) => this.categoryLabels[e.category] },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (e) => this.statusLabels[e.status],
      badge: (e) => ({
        label: this.statusLabels[e.status],
        variant: this.statusVariant(e.status),
        dot: true,
      }),
    },
  ];

  /** Map a status to a semantic pill color. */
  private statusVariant(status: ExpenseStatus): BadgeVariant {
    switch (status) {
      case 'draft':
        return 'neutral';
      case 'submitted':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  protected readonly filters: ReadonlyArray<DataTableFilter> = [
    {
      key: 'status',
      label: 'Status',
      options: [
        { label: 'All statuses', value: '' },
        ...EXPENSE_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'category',
      label: 'Category',
      options: [
        { label: 'All categories', value: '' },
        ...EXPENSE_CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: c })),
      ],
    },
  ];

  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Expense date',
    fromKey: 'expense_date_from',
    toKey: 'expense_date_to',
  };

  /** Row actions, filtered by capability + per-row policy (mirrors backend). */
  protected readonly actions = computed<ReadonlyArray<DataTableAction<Expense>>>(() => {
    const acts: DataTableAction<Expense>[] = [
      { id: 'view', label: 'View', icon: 'view' },
    ];

    // Owner can edit a draft or a rejected expense.
    acts.push({
      id: 'edit',
      label: 'Edit',
      icon: 'edit',
      isDisabled: (e) => !this.canEdit(e),
      disabledLabel: () => 'Only draft or rejected expenses you own can be edited',
    });

    // Reviewers approve/reject submitted expenses.
    if (this.isReviewer()) {
      acts.push({
        id: 'review',
        label: 'Review',
        icon: 'check',
        isDisabled: (e) => e.status !== 'submitted',
        disabledLabel: () => 'Only submitted expenses can be reviewed',
      });
    }

    if (this.canDelete()) {
      acts.push({
        id: 'delete',
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
        isDisabled: (e) => !this.canDeleteRow(e),
        disabledLabel: () => 'Only draft or rejected expenses can be deleted',
      });
    }
    return acts;
  });

  // ---- Forms ----
  protected readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(500)]],
    category: ['travel' as ExpenseCategory, [Validators.required]],
    expense_date: ['', [Validators.required]],
    notes: ['', [Validators.maxLength(5000)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currency: ['USD' as ExpenseCurrency, [Validators.required]],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(500)]],
    category: ['travel' as ExpenseCategory, [Validators.required]],
    expense_date: ['', [Validators.required]],
    notes: ['', [Validators.maxLength(5000)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currency: ['USD' as ExpenseCurrency, [Validators.required]],
  });

  protected readonly reviewForm = this.fb.nonNullable.group({
    decision: ['approve' as 'approve' | 'reject', [Validators.required]],
    rejection_reason: ['', [Validators.maxLength(1000)]],
  });

  /**
   * Attachment upload config for expenses: docs/images/pdf/excel/csv, <= 5 MB each,
   * max 5 files (matches the UI hint and the backend allow-list). The shared uploader
   * is fully driven by this config.
   */
  protected readonly attachmentConfig: FileUploadConfig = {
    accept: ['image', 'pdf', 'excel', 'csv', 'doc'],
    maxSizeBytes: mb(5),
    maxFiles: 5,
  };
  /** Files picked in the active form (names sent on submit; bytes ignored for now). */
  protected readonly attachments = signal<SelectedFile[]>([]);

  constructor() {
    this.list.init();
  }

  // ---- Per-row policy (mirrors backend) ----
  private isOwner(expense: Expense): boolean {
    return !!expense.created_by && expense.created_by.uuid === this.currentUserUuid();
  }

  private isEditableStatus(expense: Expense): boolean {
    return expense.status === 'draft' || expense.status === 'rejected';
  }

  private canEdit(expense: Expense): boolean {
    return this.isOwner(expense) && this.isEditableStatus(expense);
  }

  private canDeleteRow(expense: Expense): boolean {
    // Reviewers may delete any visible expense; owners only draft/rejected of their own.
    if (this.isReviewer()) return true;
    return this.isOwner(expense) && this.isEditableStatus(expense);
  }

  protected userName(user: Expense['created_by']): string {
    return user ? `${user.first_name} ${user.last_name}` : '—';
  }

  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  protected formatMoney(amount: number, currency: ExpenseCurrency): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount ?? 0);
  }

  // ---- Attachment presentation helpers ----

  /** Human-readable file size (e.g. "2.4 MB"), or '' when size is unknown. */
  protected fileSize(file: ExpenseFile): string {
    return file.file_size ? formatFileSize(file.file_size) : '';
  }

  /**
   * A short kind key used to pick an icon + accent for a file, derived from its mime
   * type (falling back to the extension). Keeps the template declarative.
   */
  protected fileKind(file: ExpenseFile): 'image' | 'pdf' | 'sheet' | 'doc' | 'file' {
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
  protected fileBadge(file: ExpenseFile): string {
    return { image: 'IMG', pdf: 'PDF', sheet: 'XLS', doc: 'DOC', file: 'FILE' }[
      this.fileKind(file)
    ];
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
    this.createForm.reset({
      title: '',
      category: 'travel',
      expense_date: '',
      notes: '',
      amount: null,
      currency: 'USD',
    });
    this.attachments.set([]);
    this.openModal.set('create');
  }

  protected onAction(event: { actionId: string; row: Expense }): void {
    switch (event.actionId) {
      case 'view':
        this.openView(event.row);
        break;
      case 'edit':
        this.openEdit(event.row);
        break;
      case 'review':
        this.openReview(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  private openView(expense: Expense): void {
    this.activeExpense.set(expense);
    this.openModal.set('view');
  }

  private openEdit(expense: Expense): void {
    this.activeExpense.set(expense);
    this.editForm.reset({
      title: expense.title,
      category: expense.category,
      expense_date: expense.expense_date,
      notes: expense.notes ?? '',
      amount: expense.amount,
      currency: expense.currency,
    });
    // Pre-load existing attachment names so the count/rules reflect reality.
    this.attachments.set([]);
    this.openModal.set('edit');
  }

  private openReview(expense: Expense): void {
    this.activeExpense.set(expense);
    this.reviewForm.reset({ decision: 'approve', rejection_reason: '' });
    this.openModal.set('review');
  }

  protected closeModal(): void {
    this.openModal.set(null);
    this.activeExpense.set(null);
  }



  // ---- Submit handlers ----

  /** The raw File objects currently picked in the uploader. */
  private pickedFiles(): File[] {
    return this.attachments().map((f) => f.file);
  }

  /**
   * Create flow (files are real now):
   *   1. Create the expense (always a draft — it must exist before files can attach).
   *   2. Upload any picked files to it.
   *   3. If the user chose "Save and Submit", submit it (backend requires >=1 file).
   * Each step waits for the previous one so the "submit needs an attachment" rule holds.
   */
  protected submitCreate(action: ExpenseSaveAction): void {
    this.pendingAction.set(action);
    if (this.createForm.invalid) {
      markAllAsTouched(this.createForm);
      return;
    }
    const files = this.pickedFiles();
    if (action === 'submit' && files.length === 0) {
      this.notify.error('At least one attachment is required to submit an expense.');
      return;
    }
    const v = this.createForm.getRawValue();

    this.submitting.set(true);
    this.expenses
      .create({
        action: 'draft', // always create as draft; submit happens after files upload
        title: v.title.trim(),
        category: v.category,
        expense_date: v.expense_date,
        notes: v.notes?.trim() || undefined,
        amount: Number(v.amount),
        currency: v.currency,
      })
      .pipe(
        // Upload picked files (if any) to the freshly-created expense.
        switchMap((expense) =>
          files.length
            ? this.expenses.uploadAttachments(expense.uuid, files).pipe(switchMap(() => of(expense)))
            : of(expense),
        ),
        // Submit if requested, now that the files exist on the expense.
        switchMap((expense) =>
          action === 'submit' ? this.expenses.submit(expense.uuid) : of(expense),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success(action === 'submit' ? 'Expense submitted.' : 'Draft saved.');
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /**
   * Edit flow: save content, upload any newly-picked files, then optionally resubmit.
   * A resubmit is allowed if the expense already has files OR the user just picked some.
   */
  protected submitEdit(action: ExpenseSaveAction): void {
    const expense = this.activeExpense();
    if (!expense) return;
    this.pendingAction.set(action);
    if (this.editForm.invalid) {
      markAllAsTouched(this.editForm);
      return;
    }
    const files = this.pickedFiles();
    const existingCount = expense.expense_attachments?.length ?? 0;

    if (action === 'submit' && files.length === 0 && existingCount === 0) {
      this.notify.error('At least one attachment is required to submit an expense.');
      return;
    }
    const v = this.editForm.getRawValue();

    this.submitting.set(true);
    this.expenses
      .update(expense.uuid, {
        // Save content only; the submit is done as a discrete step after files upload.
        title: v.title.trim(),
        category: v.category,
        expense_date: v.expense_date,
        notes: v.notes?.trim() || undefined,
        amount: Number(v.amount),
        currency: v.currency,
      })
      .pipe(
        switchMap((updated) =>
          files.length
            ? this.expenses.uploadAttachments(expense.uuid, files).pipe(switchMap(() => of(updated)))
            : of(updated),
        ),
        switchMap((updated) =>
          action === 'submit' ? this.expenses.submit(expense.uuid) : of(updated),
        ),
      )
      .subscribe({
        next: () => {
          this.notify.success(
            action === 'submit'
              ? `Expense ${expense.expense_number} submitted.`
              : `Expense ${expense.expense_number} updated.`,
          );
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Delete one already-uploaded file from the active expense (in the edit modal). */
  protected removeExistingAttachment(attachmentUuid: string): void {
    const expense = this.activeExpense();
    if (!expense) return;
    this.expenses.deleteAttachment(expense.uuid, attachmentUuid).subscribe({
      next: () => {
        // Reflect the removal in the open modal without a full reload.
        this.activeExpense.set({
          ...expense,
          expense_attachments: (expense.expense_attachments ?? []).filter(
            (a) => a.uuid !== attachmentUuid,
          ),
        });
        this.notify.success('Attachment removed.');
        this.list.reload();
      },
    });
  }

  /** Reviewer approves or rejects the active submitted expense. */
  protected submitReview(): void {
    const expense = this.activeExpense();
    if (!expense) return;
    const { decision, rejection_reason } = this.reviewForm.getRawValue();

    if (decision === 'reject' && !rejection_reason.trim()) {
      this.reviewForm.controls.rejection_reason.setErrors({ required: true });
      markAllAsTouched(this.reviewForm);
      return;
    }

    this.submitting.set(true);
    this.expenses
      .review(expense.uuid, {
        decision,
        rejection_reason: decision === 'reject' ? rejection_reason.trim() : undefined,
      })
      .subscribe({
        next: () => {
          this.notify.success(
            decision === 'approve'
              ? `Expense ${expense.expense_number} approved.`
              : `Expense ${expense.expense_number} rejected.`,
          );
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  /** Delete uses the shared confirmation modal; the action runs here on confirm. */
  private async confirmDelete(expense: Expense): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete expense',
      message: `Delete expense ${expense.expense_number}? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.expenses.remove(expense.uuid).subscribe({
      next: () => {
        this.notify.success(`Expense ${expense.expense_number} deleted.`);
        this.list.reload();
      },
    });
  }
}
