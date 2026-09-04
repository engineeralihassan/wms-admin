import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalService } from '../../../core/services/modal.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
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
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { TimesheetsService } from '../services/timesheets';
import {
  STATUS_LABELS,
  TIMESHEET_PERMISSIONS,
  TIMESHEET_STATUSES,
  type Timesheet,
  type TimesheetProject,
  type TimesheetStatus,
} from '../models/timesheet.model';

/**
 * Timesheets list page ("All timesheets").
 *
 * Visibility is scoped server-side (a normal user only sees their own timesheets; an
 * approver sees the whole org). This page makes the AVAILABLE ACTIONS role/status aware
 * for UX only — the backend re-enforces every rule. Row actions open the weekly detail
 * page; "New Timesheet" opens a small project-picker modal.
 */
@Component({
  selector: 'app-timesheet-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    DataTableComponent,
  ],
  templateUrl: './timesheet-list.html',
  styleUrl: './timesheet-list.scss',
})
export class TimesheetList {
  private readonly fb = inject(FormBuilder);
  private readonly timesheets = inject(TimesheetsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly router = inject(Router);

  protected readonly statusLabels = STATUS_LABELS;

  // ---- Role capabilities (UX gating; backend re-enforces) ----
  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(TIMESHEET_PERMISSIONS.create),
  );
  /** Approver = can approve/reject/correct; also unlocks org-wide visibility UX. */
  protected readonly isApprover = computed(() =>
    this.auth.hasPermission(TIMESHEET_PERMISSIONS.approve),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(TIMESHEET_PERMISSIONS.delete),
  );
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');

  // ---- Create-modal state ----
  protected readonly createOpen = signal(false);
  /** Projects the user may log against, loaded when the create modal opens. */
  protected readonly projectOptions = signal<TimesheetProject[]>([]);
  protected readonly loadingProjects = signal(false);

  protected readonly list = createListState<Timesheet>(
    (query) => this.timesheets.list(query),
    { sortBy: 'week_start_date', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<Timesheet>> = [
    {
      key: 'week_start_date',
      label: 'Time Period',
      sortable: true,
      value: (t) => this.formatWeek(t.week_start_date, t.week_end_date),
    },
    {
      key: 'submitted_at',
      label: 'Submission Date',
      sortable: true,
      value: (t) => this.formatDate(t.submitted_at),
      tone: 'muted',
    },
    {
      key: 'due_date',
      label: 'Due Date',
      sortable: true,
      value: (t) => this.formatDate(t.due_date),
    },
    { key: 'project', label: 'Project', value: (t) => t.project?.name ?? '—' },
    {
      key: 'total_hours',
      label: 'Total Hours',
      sortable: true,
      value: (t) => this.formatHours(t.total_hours),
      tone: 'code',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (t) => this.statusLabels[t.status],
      badge: (t) => ({
        label: this.statusLabels[t.status],
        variant: this.statusVariant(t.status),
        dot: true,
      }),
    },
  ];

  /** Map a status to a semantic pill color. */
  private statusVariant(status: TimesheetStatus): BadgeVariant {
    switch (status) {
      case 'unsubmitted':
        return 'neutral';
      case 'submitted':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'locked':
        return 'info';
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
        ...TIMESHEET_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      ],
    },
  ];

  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Week starting',
    fromKey: 'week_start_date_from',
    toKey: 'week_start_date_to',
  };

  /** Row actions, filtered by capability + per-row policy (mirrors backend). */
  protected readonly actions = computed<ReadonlyArray<DataTableAction<Timesheet>>>(() => {
    const acts: DataTableAction<Timesheet>[] = [
      { id: 'open', label: 'Open', icon: 'view' },
    ];

    // Owner can withdraw a submitted sheet (before it's reviewed / locked).
    acts.push({
      id: 'withdraw',
      label: 'Withdraw',
      icon: 'withdraw',
      isHidden: (t) => !this.canWithdraw(t),
    });

    // Approvers review submitted sheets.
    if (this.isApprover()) {
      acts.push({
        id: 'review',
        label: 'Review',
        icon: 'check',
        isDisabled: (t) => t.status !== 'submitted',
        disabledLabel: () => 'Only submitted timesheets can be reviewed',
      });
    }

    if (this.canDelete()) {
      acts.push({
        id: 'delete',
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
        isDisabled: (t) => !this.canDeleteRow(t),
        disabledLabel: () => 'Only an unsubmitted or rejected timesheet can be deleted',
      });
    }
    return acts;
  });

  // ---- Create form (project picker) ----
  protected readonly createForm = this.fb.nonNullable.group({
    project: ['', [Validators.required]],
    week_date: [''],
  });

  constructor() {
    this.list.init();
  }

  // ---- Per-row policy (mirrors backend) ----
  private isOwner(t: Timesheet): boolean {
    return !!t.owner && t.owner.uuid === this.currentUserUuid();
  }

  private isLocked(t: Timesheet): boolean {
    if (t.status === 'locked') return true;
    // The backend also locks by date; reflect that in the UI defensively.
    return new Date(t.lock_date).getTime() <= this.todayMs();
  }

  private canWithdraw(t: Timesheet): boolean {
    return this.isOwner(t) && t.status === 'submitted' && !this.isLocked(t);
  }

  private canDeleteRow(t: Timesheet): boolean {
    const editable = t.status === 'unsubmitted' || t.status === 'rejected';
    if (this.isApprover()) return true;
    return this.isOwner(t) && editable && !this.isLocked(t);
  }

  private todayMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  // ---- Table event handlers ----
  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  protected onAction(event: { actionId: string; row: Timesheet }): void {
    switch (event.actionId) {
      case 'open':
      case 'review':
        this.openDetail(event.row);
        break;
      case 'withdraw':
        void this.confirmWithdraw(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  /** Navigate to the weekly detail page (view / edit / review all happen there). */
  private openDetail(t: Timesheet): void {
    void this.router.navigate([APP_ROUTES.timesheets, t.uuid]);
  }

  // ---- Create flow ----
  protected openCreate(): void {
    this.createForm.reset({ project: '', week_date: '' });
    this.createOpen.set(true);
    this.loadingProjects.set(true);
    this.timesheets.projects().subscribe({
      next: (projects) => {
        this.projectOptions.set(projects);
        this.loadingProjects.set(false);
      },
      error: () => this.loadingProjects.set(false),
    });
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
  }

  protected submitCreate(): void {
    if (this.createForm.invalid) {
      markAllAsTouched(this.createForm);
      return;
    }
    const v = this.createForm.getRawValue();
    this.submitting.set(true);
    this.timesheets
      .create({ project: v.project, week_date: v.week_date || undefined })
      .subscribe({
        next: (created) => {
          this.notify.success('Timesheet ready. Fill in your hours.');
          this.submitting.set(false);
          this.createOpen.set(false);
          this.list.reload();
          // Jump straight into the weekly grid for the freshly-opened week.
          void this.router.navigate([APP_ROUTES.timesheets, created.uuid]);
        },
        error: () => this.submitting.set(false),
      });
  }

  // ---- Destructive actions (shared confirm) ----
  private async confirmWithdraw(t: Timesheet): Promise<void> {
    const ok = await this.modal.confirm({
      title: 'Withdraw timesheet',
      message: `Withdraw ${t.timesheet_number}? It will return to unsubmitted so you can edit it.`,
      confirmText: 'Withdraw',
    });
    if (!ok) return;
    this.timesheets.withdraw(t.uuid).subscribe({
      next: () => {
        this.notify.success(`${t.timesheet_number} withdrawn.`);
        this.list.reload();
      },
    });
  }

  private async confirmDelete(t: Timesheet): Promise<void> {
    const ok = await this.modal.confirm({
      title: 'Delete timesheet',
      message: `Delete ${t.timesheet_number}? This cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.timesheets.remove(t.uuid).subscribe({
      next: () => {
        this.notify.success(`${t.timesheet_number} deleted.`);
        this.list.reload();
      },
    });
  }

  // ---- Formatting helpers ----
  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  /** "Sep 06, 2026 - Sep 12, 2026" style range (matches the reference screen). */
  protected formatWeek(start: string, end: string): string {
    return `${this.formatDate(start)} - ${this.formatDate(end)}`;
  }

  protected formatHours(hours: number): string {
    const n = Number(hours) || 0;
    return `${n % 1 === 0 ? n : n.toFixed(2)}`;
  }
}
