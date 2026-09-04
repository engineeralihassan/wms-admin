import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalService } from '../../../core/services/modal.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { TimesheetsService } from '../services/timesheets';
import {
  STATUS_LABELS,
  TIMESHEET_PERMISSIONS,
  type Timesheet,
  type TimesheetEntryInput,
  type TimesheetStatus,
} from '../models/timesheet.model';

/** The weekday label for a given ISO date (e.g. "Sunday"). */
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

/**
 * Timesheet weekly detail page — the "Submit Timesheet" screen.
 *
 * Shows the 7 daily rows (hours + note) as a FormArray, a header with the time period,
 * project, status and total hours, and the owner actions (save draft / submit /
 * withdraw). Approvers additionally get a review panel (approve/reject) and a correction
 * flow (edit hours + accept, even after lock). Every rule is re-enforced by the backend;
 * the UI just gates the controls for a clean UX.
 */
@Component({
  selector: 'app-timesheet-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CardComponent, ButtonComponent, ModalComponent],
  templateUrl: './timesheet-detail.html',
  styleUrl: './timesheet-detail.scss',
})
export class TimesheetDetail {
  private readonly fb = inject(FormBuilder);
  private readonly timesheets = inject(TimesheetsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly router = inject(Router);

  /** Route param, bound via withComponentInputBinding(). */
  readonly uuid = input.required<string>();

  protected readonly statusLabels = STATUS_LABELS;

  protected readonly timesheet = signal<Timesheet | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  // ---- Role capabilities (UX gating; backend re-enforces) ----
  protected readonly isApprover = computed(() =>
    this.auth.hasPermission(TIMESHEET_PERMISSIONS.approve),
  );
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  /**
   * Parent form holding the 7 day rows under `entries`. Wrapping the FormArray in a
   * group lets the template bind it cleanly with [formGroup] + formArrayName="entries".
   */
  protected readonly weekForm = this.fb.group({
    entries: this.fb.array<ReturnType<TimesheetDetail['makeRow']>>([]),
  });

  /** Convenience accessor for the day-rows FormArray. */
  protected get entriesForm(): FormArray<ReturnType<TimesheetDetail['makeRow']>> {
    return this.weekForm.controls.entries;
  }

  /** Approver review form. */
  protected readonly reviewForm = this.fb.nonNullable.group({
    decision: ['approve' as 'approve' | 'reject', [Validators.required]],
    rejection_reason: ['', [Validators.maxLength(1000)]],
    review_note: ['', [Validators.maxLength(1000)]],
  });
  protected readonly reviewOpen = signal(false);

  // ---- Derived view state ----
  protected readonly isOwner = computed(() => {
    const t = this.timesheet();
    return !!t?.owner && t.owner.uuid === this.currentUserUuid();
  });

  protected readonly isLocked = computed(() => {
    const t = this.timesheet();
    if (!t) return false;
    if (t.status === 'locked') return true;
    return new Date(t.lock_date).getTime() <= this.todayMs();
  });

  /** Owner may edit hours only while unsubmitted/rejected AND before the lock date. */
  protected readonly canEditEntries = computed(() => {
    const t = this.timesheet();
    if (!t) return false;
    const editableStatus = t.status === 'unsubmitted' || t.status === 'rejected';
    return this.isOwner() && editableStatus && !this.isLocked();
  });

  protected readonly canSubmit = computed(() => this.canEditEntries());
  protected readonly canWithdraw = computed(() => {
    const t = this.timesheet();
    return !!t && this.isOwner() && t.status === 'submitted' && !this.isLocked();
  });
  protected readonly canReview = computed(() => {
    const t = this.timesheet();
    return !!t && this.isApprover() && t.status === 'submitted';
  });
  /** Approvers can correct any sheet (including locked) to backfill hours. */
  protected readonly canCorrect = computed(() => this.isApprover());

  /** Live total from the current form values (before saving). */
  protected readonly liveTotal = computed(() => {
    // Recomputed on each render; the form isn't a signal, so read raw values.
    return this.entriesForm.controls.reduce(
      (sum, row) => sum + (Number(row.controls.hours.value) || 0),
      0,
    );
  });

  ngOnInit(): void {
    this.load();
  }

  private todayMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private makeRow(entry: { work_date: string; hours: number; note: string | null }) {
    return this.fb.group({
      work_date: [entry.work_date],
      hours: [
        Number(entry.hours) || 0,
        [Validators.required, Validators.min(0), Validators.max(24)],
      ],
      note: [entry.note ?? '', [Validators.maxLength(1000)]],
    });
  }

  private load(): void {
    this.loading.set(true);
    this.timesheets.getByUuid(this.uuid()).subscribe({
      next: (ts) => {
        this.timesheet.set(ts);
        this.rebuildForm(ts);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notify.error('Could not load this timesheet.');
        void this.router.navigate([APP_ROUTES.timesheets]);
      },
    });
  }

  /** Rebuild the 7-row form from the loaded entries (sorted by date). */
  private rebuildForm(ts: Timesheet): void {
    this.entriesForm.clear();
    const rows = [...(ts.entries ?? [])].sort((a, b) =>
      a.work_date.localeCompare(b.work_date),
    );
    rows.forEach((e) => this.entriesForm.push(this.makeRow(e)));
    if (!this.canEditEntries()) this.entriesForm.disable();
    else this.entriesForm.enable();
  }

  // ---- Display helpers ----
  protected weekdayLabel(date: string): string {
    return WEEKDAY.format(new Date(date));
  }

  protected dayLabel(date: string): string {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
      new Date(date),
    );
  }

  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  protected weekLabel(): string {
    const t = this.timesheet();
    if (!t) return '';
    return `${this.formatDate(t.week_start_date)} - ${this.formatDate(t.week_end_date)}`;
  }

  protected statusVariantClass(status: TimesheetStatus): string {
    return `status-pill status-pill--${status}`;
  }

  // ---- Payload builder ----
  private entriesPayload(): TimesheetEntryInput[] {
    return this.entriesForm.controls.map((row) => ({
      work_date: row.controls.work_date.value as string,
      hours: Number(row.controls.hours.value) || 0,
      note: (row.controls.note.value as string)?.trim() || null,
    }));
  }

  // ---- Owner actions ----
  protected saveDraft(): void {
    if (this.entriesForm.invalid) {
      this.weekForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.timesheets.saveEntries(this.uuid(), { entries: this.entriesPayload() }).subscribe({
      next: (ts) => {
        this.timesheet.set(ts);
        this.rebuildForm(ts);
        this.saving.set(false);
        this.notify.success('Timesheet saved.');
      },
      error: () => this.saving.set(false),
    });
  }

  protected submit(): void {
    if (this.entriesForm.invalid) {
      this.weekForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    // Save the latest edits first, then submit — so "Submit" always reflects the grid.
    this.timesheets.saveEntries(this.uuid(), { entries: this.entriesPayload() }).subscribe({
      next: () => {
        this.timesheets.submit(this.uuid()).subscribe({
          next: (ts) => {
            this.timesheet.set(ts);
            this.rebuildForm(ts);
            this.saving.set(false);
            this.notify.success('Timesheet submitted for approval.');
          },
          error: () => this.saving.set(false),
        });
      },
      error: () => this.saving.set(false),
    });
  }

  protected async withdraw(): Promise<void> {
    const t = this.timesheet();
    if (!t) return;
    const ok = await this.modal.confirm({
      title: 'Withdraw timesheet',
      message: `Withdraw ${t.timesheet_number}? It will return to unsubmitted so you can edit it.`,
      confirmText: 'Withdraw',
    });
    if (!ok) return;
    this.saving.set(true);
    this.timesheets.withdraw(this.uuid()).subscribe({
      next: (ts) => {
        this.timesheet.set(ts);
        this.rebuildForm(ts);
        this.saving.set(false);
        this.notify.success('Timesheet withdrawn.');
      },
      error: () => this.saving.set(false),
    });
  }

  // ---- Approver review ----
  protected openReview(): void {
    this.reviewForm.reset({ decision: 'approve', rejection_reason: '', review_note: '' });
    this.reviewOpen.set(true);
  }

  protected closeReview(): void {
    this.reviewOpen.set(false);
  }

  protected submitReview(): void {
    const { decision, rejection_reason, review_note } = this.reviewForm.getRawValue();
    if (decision === 'reject' && !rejection_reason.trim()) {
      this.reviewForm.controls.rejection_reason.setErrors({ required: true });
      markAllAsTouched(this.reviewForm);
      return;
    }
    this.saving.set(true);
    this.timesheets
      .review(this.uuid(), {
        decision,
        rejection_reason: decision === 'reject' ? rejection_reason.trim() : undefined,
        review_note: review_note.trim() || undefined,
      })
      .subscribe({
        next: (ts) => {
          this.timesheet.set(ts);
          this.rebuildForm(ts);
          this.saving.set(false);
          this.reviewOpen.set(false);
          this.notify.success(
            decision === 'approve' ? 'Timesheet approved.' : 'Timesheet rejected.',
          );
        },
        error: () => this.saving.set(false),
      });
  }

  /**
   * Approver correction: edit the grid on the owner's behalf (even when locked) and
   * accept. Sends the current grid + a note; the backend notifies the owner.
   */
  protected correctAndAccept(): void {
    if (this.entriesForm.invalid) {
      this.weekForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.timesheets
      .correct(this.uuid(), {
        entries: this.entriesPayload(),
        status: 'approved',
        review_note: 'Corrected and accepted by an administrator.',
      })
      .subscribe({
        next: (ts) => {
          this.timesheet.set(ts);
          this.rebuildForm(ts);
          this.saving.set(false);
          this.notify.success('Timesheet corrected and accepted. The owner was notified.');
        },
        error: () => this.saving.set(false),
      });
  }

  /** Let an approver unlock the grid for editing when the owner can't. */
  protected enableForCorrection(): void {
    this.entriesForm.enable();
  }

  protected goBack(): void {
    void this.router.navigate([APP_ROUTES.timesheets]);
  }
}
