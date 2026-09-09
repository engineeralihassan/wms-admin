import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
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
  type DataTableFilter,
} from '../../../shared/components/data-table/data-table.component';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { createListState } from '../../../shared/list/list-state';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { JobsService } from '../services/jobs.service';
import { InterviewsService } from '../services/interviews.service';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_OPTIONS,
  ATS_PERMISSIONS,
  EMPLOYMENT_TYPE_LABELS,
  INTERVIEW_ACTIVE_STATUSES,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODE_OPTIONS,
  INTERVIEW_PROVIDER_LABELS,
  INTERVIEW_STATUS_LABELS,
  JOB_STATUS_LABELS,
  SCREENING_BAND_LABELS,
  WORK_MODE_LABELS,
  type ApplicationStatus,
  type AvailabilitySlot,
  type Interview,
  type InterviewMode,
  type InterviewProvider,
  type InterviewProviderInfo,
  type InterviewRound,
  type Job,
  type JobApplication,
  type InterviewerOption,
  type ScreeningBand,
  type ScreeningSummary,
} from '../models/ats.model';

/**
 * Job detail = a single job's header + its applicants pipeline.
 *
 * Opening an applicant loads the full application (candidate details, downloadable CV
 * and attachments, and the audit-trail timeline) and exposes the recruiter workflow:
 * change status (choosing an interview round when moving to "interviewing"), set a
 * rating, add notes, and delete. The backend enforces that a recruiter can only touch
 * applications to their own jobs.
 */
@Component({
  selector: 'app-job-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    DataTableComponent,
  ],
  templateUrl: './job-detail.html',
  styleUrls: ['./job-detail.scss', './interviews.scss'],
})
export class JobDetail implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly jobs = inject(JobsService);
  private readonly interviews = inject(InterviewsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly router = inject(Router);

  /** Route param bound via withComponentInputBinding(). */
  readonly uuid = input.required<string>();

  protected readonly statusLabels = JOB_STATUS_LABELS;
  protected readonly employmentLabels = EMPLOYMENT_TYPE_LABELS;
  protected readonly workModeLabels = WORK_MODE_LABELS;
  protected readonly appStatusLabels = APPLICATION_STATUS_LABELS;
  protected readonly appStatusOptions = APPLICATION_STATUS_OPTIONS;

  protected readonly canUpdate = computed(() =>
    this.auth.hasPermission(ATS_PERMISSIONS.applicationUpdate),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(ATS_PERMISSIONS.applicationDelete),
  );
  protected readonly canReadInterviews = computed(() =>
    this.auth.hasPermission(ATS_PERMISSIONS.interviewRead),
  );
  protected readonly canScheduleInterview = computed(() =>
    this.auth.hasPermission(ATS_PERMISSIONS.interviewCreate),
  );
  protected readonly canManageInterview = computed(() =>
    this.auth.hasPermission(ATS_PERMISSIONS.interviewUpdate),
  );

  protected readonly job = signal<Job | null>(null);
  protected readonly loadingJob = signal(true);
  protected readonly submitting = signal(false);

  /** The application open in the drawer, with attachments + events. */
  protected readonly activeApplication = signal<JobApplication | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly searchValue = signal('');

  /** Interview rounds of the current job (drives the stage picker). */
  protected readonly rounds = computed<InterviewRound[]>(() => this.job()?.interview_rounds ?? []);

  // ── Interview scheduling ────────────────────────────────────────────────────
  protected readonly interviewStatusLabels = INTERVIEW_STATUS_LABELS;
  protected readonly interviewModeLabels = INTERVIEW_MODE_LABELS;
  protected readonly interviewModeOptions = INTERVIEW_MODE_OPTIONS;
  protected readonly interviewProviderLabels = INTERVIEW_PROVIDER_LABELS;

  /** Interviews booked for the open application. */
  protected readonly appInterviews = signal<Interview[]>([]);
  protected readonly interviewsLoading = signal(false);

  /** Providers enabled on the server (loaded once). */
  protected readonly providers = signal<InterviewProviderInfo[]>([]);
  /** Only providers the server reports as enabled — offered in the picker. */
  protected readonly enabledProviders = computed<InterviewProvider[]>(() => {
    const enabled = this.providers()
      .filter((p) => p.enabled)
      .map((p) => p.key);
    // Manual is always usable even if the snapshot hasn't loaded yet.
    return enabled.length ? enabled : ['manual'];
  });

  /** Schedule-interview modal state. */
  protected readonly scheduleOpen = signal(false);
  protected readonly scheduling = signal(false);

  /** Interviewer directory (org users) for the panel picker. */
  protected readonly interviewerOptions = signal<InterviewerOption[]>([]);

  /** Availability results for the picked window + interviewers. */
  protected readonly slots = signal<AvailabilitySlot[]>([]);
  protected readonly slotsLoading = signal(false);
  protected readonly selectedSlotStart = signal<string | null>(null);

  /** Default the timezone selector to the browser's zone. */
  protected readonly browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  /** A reasonable IANA timezone list for the selector (browser-supported). */
  protected readonly timezoneOptions: string[] = ((): string[] => {
    const supported =
      typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
        .supportedValuesOf === 'function'
        ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
            'timeZone',
          )
        : [];
    const tz = this.browserTimezone;
    return supported.length ? supported : [tz, 'UTC'];
  })();

  protected readonly scheduleForm = this.fb.nonNullable.group({
    stage_key: ['', [Validators.required]],
    provider: ['manual' as InterviewProvider, [Validators.required]],
    mode: ['video' as InterviewMode, [Validators.required]],
    timezone: [this.browserTimezone, [Validators.required]],
    duration_minutes: [60, [Validators.required, Validators.min(10), Validators.max(480)]],
    date_from: ['', [Validators.required]],
    date_to: ['', [Validators.required]],
    // A single interviewer uuid picker (kept simple; backend accepts a panel array).
    interviewer_uuid: ['', [Validators.required]],
    meeting_url: [''],
    location: [''],
    notes: [''],
  });

  /**
   * True when the chosen mode needs a manual meeting link (manual provider + video).
   * Read as a method (not a computed) because a reactive form's value is not a signal —
   * a computed would freeze on its first read and ignore later dropdown changes.
   */
  protected needsManualLink(): boolean {
    const v = this.scheduleForm.getRawValue();
    return v.mode === 'video' && v.provider === 'manual';
  }

  /** True when the chosen mode needs a physical location (onsite). */
  protected needsLocation(): boolean {
    return this.scheduleForm.getRawValue().mode === 'onsite';
  }

  protected readonly list = createListState<JobApplication>(
    (query) => this.jobs.listApplications(this.uuid(), query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  // ── Top candidates (resume screening) ──────────────────────────────────────
  protected readonly bandLabels = SCREENING_BAND_LABELS;
  protected readonly rankedOpen = signal(false);
  protected readonly rankedLoading = signal(false);
  protected readonly rankedItems = signal<JobApplication[]>([]);
  protected readonly rankedSummary = signal<ScreeningSummary | null>(null);
  protected readonly rankedLimit = signal(10);

  /** Load (or reload) the ranked candidates for this job. */
  protected loadRanked(): void {
    this.rankedLoading.set(true);
    this.jobs.listRankedApplications(this.uuid(), this.rankedLimit()).subscribe({
      next: (res) => {
        this.rankedItems.set(res.data);
        this.rankedSummary.set(res.meta.screening);
        this.rankedLoading.set(false);
      },
      error: () => this.rankedLoading.set(false),
    });
  }

  /** Toggle the top-candidates panel, loading on first open. */
  protected toggleRanked(): void {
    const next = !this.rankedOpen();
    this.rankedOpen.set(next);
    if (next && this.rankedItems().length === 0) this.loadRanked();
  }

  protected readonly screening = signal(false);

  /** Manually trigger screening for this job's applications. */
  protected screenCandidates(): void {
    this.screening.set(true);
    this.jobs.screenJob(this.uuid()).subscribe({
      next: (r) => {
        this.screening.set(false);
        if (!r.enabled) {
          this.notify.info('Resume screening is not configured on the server.');
          return;
        }
        if (r.queued === 0) {
          this.notify.info('All candidates are already screened.');
        } else {
          this.notify.success(`Screening ${r.queued} candidate(s). Scores appear shortly.`);
        }
        // Reload after a short delay so early results show up.
        setTimeout(() => this.loadRanked(), 1500);
      },
      error: () => this.screening.set(false),
    });
  }

  /** CSS modifier for a score band chip. */
  protected bandClass(band?: string | null): string {
    return band ? `band--${band}` : 'band--none';
  }

  /** Human label for a score band (falls back to the raw value). */
  protected bandLabel(band?: string | null): string {
    if (!band) return '';
    return this.bandLabels[band as ScreeningBand] ?? band;
  }

  /** Comma-joined list of the top missing requirements for a ranked candidate. */
  protected missedText(app: JobApplication): string {
    const missed = app.screening_breakdown?.missed_requirements ?? [];
    return missed
      .slice(0, 4)
      .map((m) => m.requirement)
      .join(', ');
  }

  /** Open the drawer for a ranked candidate (reuses the applicant drawer). */
  protected openRanked(app: JobApplication): void {
    this.openApplication(app);
  }

  protected readonly columns: ReadonlyArray<DataTableColumn<JobApplication>> = [
    { key: 'application_number', label: 'Ref', value: (a) => a.application_number, tone: 'code' },
    { key: 'candidate_name', label: 'Candidate', sortable: true, value: (a) => a.candidate_name },
    { key: 'candidate_email', label: 'Email', value: (a) => a.candidate_email },
    {
      key: 'experience_years',
      label: 'Exp (yrs)',
      value: (a) => (a.experience_years != null ? String(a.experience_years) : '—'),
    },
    {
      key: 'stage_key',
      label: 'Round',
      value: (a) => this.roundName(a.stage_key),
    },
    {
      key: 'rating',
      label: 'Rating',
      sortable: true,
      value: (a) => (a.rating ? '★'.repeat(a.rating) : '—'),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (a) => this.appStatusLabels[a.status],
      badge: (a) => ({
        label: this.appStatusLabels[a.status],
        variant: this.statusVariant(a.status),
        dot: true,
      }),
    },
  ];

  private statusVariant(status: ApplicationStatus): BadgeVariant {
    switch (status) {
      case 'new':
        return 'neutral';
      case 'in_review':
      case 'shortlisted':
        return 'info';
      case 'interviewing':
        return 'warning';
      case 'selected':
      case 'hired':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'on_hold':
        return 'neutral';
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
        ...APPLICATION_STATUS_OPTIONS.map((s) => ({ label: APPLICATION_STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'stage_key',
      label: 'Round',
      options: [
        { label: 'All rounds', value: '' },
        ...this.rounds().map((r) => ({ label: r.name, value: r.key })),
      ],
    },
  ]);

  protected readonly actions = computed<ReadonlyArray<DataTableAction<JobApplication>>>(() => {
    const acts: DataTableAction<JobApplication>[] = [{ id: 'open', label: 'Open', icon: 'view' }];
    if (this.canDelete()) {
      acts.push({ id: 'delete', label: 'Delete', icon: 'delete', variant: 'danger' });
    }
    return acts;
  });

  // ── Workflow forms ─────────────────────────────────────────────────────────
  protected readonly statusForm = this.fb.nonNullable.group({
    status: ['in_review' as ApplicationStatus, [Validators.required]],
    stage_key: [''],
    decision_reason: [''],
    note: [''],
  });

  protected readonly noteForm = this.fb.nonNullable.group({
    note: ['', [Validators.required, Validators.maxLength(2000)]],
  });

  protected readonly ratingForm = this.fb.nonNullable.group({
    rating: [3, [Validators.required, Validators.min(1), Validators.max(5)]],
  });

  ngOnInit(): void {
    // Route inputs (uuid) are bound by the time ngOnInit runs — NOT in the constructor,
    // so both the job load and the applications list (which read uuid()) must start here.
    this.loadJob();
    this.list.init();
    // Load provider availability once (best-effort; the manual provider always works).
    if (this.canScheduleInterview()) {
      this.interviews.getProviders().subscribe({
        next: (p) => this.providers.set(p),
        error: () => this.providers.set([{ key: 'manual', enabled: true, configured: true }]),
      });
    }
  }

  private loadJob(): void {
    this.loadingJob.set(true);
    this.jobs.getByUuid(this.uuid()).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loadingJob.set(false);
      },
      error: () => {
        this.loadingJob.set(false);
        this.notify.error('Could not load this job.');
        this.router.navigate([APP_ROUTES.jobs]);
      },
    });
  }

  protected back(): void {
    this.router.navigate([APP_ROUTES.jobs]);
  }

  protected roundName(key: string | null): string {
    if (!key) return '—';
    return this.rounds().find((r) => r.key === key)?.name ?? key;
  }

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  protected onAction(event: { actionId: string; row: JobApplication }): void {
    switch (event.actionId) {
      case 'open':
        this.openApplication(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  // ── Drawer ───────────────────────────────────────────────────────────────
  protected openApplication(app: JobApplication): void {
    this.drawerOpen.set(true);
    this.activeApplication.set(app); // show a light version immediately
    // Fetch the full record (attachments + events).
    this.jobs.getApplication(app.uuid).subscribe({
      next: (full) => {
        this.activeApplication.set(full);
        this.statusForm.reset({
          status: full.status,
          stage_key: full.stage_key ?? this.rounds()[0]?.key ?? '',
          decision_reason: '',
          note: '',
        });
        this.ratingForm.reset({ rating: full.rating ?? 3 });
        this.noteForm.reset({ note: '' });
      },
      error: () => this.notify.error('Could not load the application.'),
    });
    // Load interviews for this candidate (if the user may see them).
    if (this.canReadInterviews()) this.loadInterviews(app.uuid);
  }

  protected closeDrawer(): void {
    this.drawerOpen.set(false);
    this.activeApplication.set(null);
    this.appInterviews.set([]);
    this.scheduleOpen.set(false);
  }

  // ── Interview: list ──────────────────────────────────────────────────────
  private loadInterviews(applicationUuid: string): void {
    this.interviewsLoading.set(true);
    this.interviews.listForApplication(applicationUuid).subscribe({
      next: (items) => {
        this.appInterviews.set(items);
        this.interviewsLoading.set(false);
      },
      error: () => this.interviewsLoading.set(false),
    });
  }

  /** Whether an interview is still active (can be managed). */
  protected isInterviewActive(i: Interview): boolean {
    return INTERVIEW_ACTIVE_STATUSES.includes(i.status);
  }

  protected interviewerNames(i: Interview): string {
    const names = i.participants
      .filter((p) => p.role === 'interviewer')
      .map((p) => p.name || p.email);
    return names.length ? names.join(', ') : '—';
  }

  // ── Interview: schedule modal ────────────────────────────────────────────
  protected openSchedule(): void {
    const app = this.activeApplication();
    if (!app) return;
    // Default the round to the application's current stage, else the first round.
    const defaultStage = app.stage_key ?? this.rounds()[0]?.key ?? '';
    const today = new Date();
    const inTwoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const provider = this.enabledProviders().includes('google')
      ? 'google'
      : this.enabledProviders()[0];
    this.scheduleForm.reset({
      stage_key: defaultStage,
      provider: provider as InterviewProvider,
      mode: 'video',
      timezone: this.browserTimezone,
      duration_minutes: 60,
      date_from: this.toDateInput(today),
      date_to: this.toDateInput(inTwoWeeks),
      interviewer_uuid: '',
      meeting_url: '',
      location: '',
      notes: '',
    });
    this.slots.set([]);
    this.selectedSlotStart.set(null);
    this.scheduleOpen.set(true);
    // Load interviewer options lazily on first open (scoped to this application's org).
    if (this.interviewerOptions().length === 0) this.loadInterviewers(app.uuid);
  }

  protected closeSchedule(): void {
    this.scheduleOpen.set(false);
  }

  private loadInterviewers(applicationUuid: string): void {
    this.interviews.listInterviewers(applicationUuid).subscribe({
      next: (options) => this.interviewerOptions.set(options),
      error: () => this.notify.error('Could not load interviewers.'),
    });
  }

  /** Display name for an interviewer option. */
  protected interviewerLabel(u: InterviewerOption): string {
    return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email;
  }

  /** Fetch bookable slots for the chosen window + interviewer. */
  protected findSlots(): void {
    const app = this.activeApplication();
    if (!app) return;
    const v = this.scheduleForm.getRawValue();
    if (!v.interviewer_uuid) {
      this.notify.error('Pick an interviewer first.');
      return;
    }
    if (!v.date_from || !v.date_to) {
      this.notify.error('Choose a date range.');
      return;
    }
    this.slotsLoading.set(true);
    this.selectedSlotStart.set(null);
    this.interviews
      .getAvailability(app.uuid, {
        date_from: new Date(v.date_from).toISOString(),
        // include the whole end day
        date_to: new Date(new Date(v.date_to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
        timezone: v.timezone,
        duration_minutes: Number(v.duration_minutes),
        interviewer_uuids: [v.interviewer_uuid],
      })
      .subscribe({
        next: (res) => {
          this.slots.set(res.slots);
          this.slotsLoading.set(false);
          if (res.slots.length === 0) {
            this.notify.info('No free slots in that range. Try widening it.');
          }
        },
        error: () => this.slotsLoading.set(false),
      });
  }

  protected selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlotStart.set(slot.start);
  }

  protected submitSchedule(): void {
    const app = this.activeApplication();
    if (!app) return;
    if (this.scheduleForm.invalid) {
      markAllAsTouched(this.scheduleForm);
      return;
    }
    const start = this.selectedSlotStart();
    if (!start) {
      this.notify.error('Pick a time slot.');
      return;
    }
    const v = this.scheduleForm.getRawValue();
    if (this.needsManualLink() && !v.meeting_url.trim()) {
      this.notify.error('Paste a meeting link for a manual video interview.');
      return;
    }
    if (this.needsLocation() && !v.location.trim()) {
      this.notify.error('A location is required for an on-site interview.');
      return;
    }
    this.scheduling.set(true);
    this.interviews
      .schedule(app.uuid, {
        stage_key: v.stage_key,
        start,
        duration_minutes: Number(v.duration_minutes),
        timezone: v.timezone,
        mode: v.mode,
        provider: v.provider,
        interviewer_uuids: [v.interviewer_uuid],
        meeting_url: v.meeting_url.trim() || undefined,
        location: v.location.trim() || undefined,
        notes: v.notes.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.notify.success('Interview scheduled. Invites are on their way.');
          this.scheduling.set(false);
          this.scheduleOpen.set(false);
          this.loadInterviews(app.uuid);
          // Booking advances the application to interviewing — refresh the record + list.
          this.jobs.getApplication(app.uuid).subscribe((full) => this.activeApplication.set(full));
          this.list.reload();
        },
        error: () => this.scheduling.set(false),
      });
  }

  // ── Interview: reschedule / cancel / complete ────────────────────────────
  protected async cancelInterview(i: Interview): Promise<void> {
    const app = this.activeApplication();
    if (!app) return;
    const confirmed = await this.modal.confirm({
      title: 'Cancel interview',
      message: `Cancel ${i.interview_number} (${this.roundName(i.stage_key)})? The calendar event will be removed and participants notified.`,
      confirmText: 'Cancel interview',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.interviews.cancel(i.uuid, {}).subscribe({
      next: () => {
        this.notify.success('Interview cancelled.');
        this.loadInterviews(app.uuid);
      },
    });
  }

  protected completeInterview(i: Interview, outcome: 'completed' | 'no_show'): void {
    const app = this.activeApplication();
    if (!app) return;
    this.interviews.complete(i.uuid, { outcome }).subscribe({
      next: () => {
        this.notify.success(outcome === 'no_show' ? 'Marked as no-show.' : 'Interview completed.');
        this.loadInterviews(app.uuid);
      },
    });
  }

  /** Format a Date as a yyyy-MM-dd string for a native date input. */
  private toDateInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Format a slot's start instant in the chosen timezone for display. */
  protected formatSlot(iso: string): string {
    const tz = this.scheduleForm.getRawValue().timezone;
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: tz,
      }).format(new Date(iso));
    } catch {
      return new Date(iso).toLocaleString();
    }
  }

  /** True when the chosen status needs an interview round selection. */
  protected readonly needsStage = computed(
    () => this.statusForm.controls.status.value === 'interviewing',
  );

  /** True when the chosen status needs a rejection reason. */
  protected needsReason(): boolean {
    return this.statusForm.controls.status.value === 'rejected';
  }

  protected submitStatus(): void {
    const app = this.activeApplication();
    if (!app) return;
    if (this.statusForm.invalid) {
      markAllAsTouched(this.statusForm);
      return;
    }
    const v = this.statusForm.getRawValue();
    if (v.status === 'interviewing' && !v.stage_key) {
      this.notify.error('Select which interview round the candidate is in.');
      return;
    }
    if (v.status === 'rejected' && !v.decision_reason.trim()) {
      this.notify.error('A reason is required to reject a candidate.');
      return;
    }
    this.submitting.set(true);
    this.jobs
      .changeApplicationStatus(app.uuid, {
        status: v.status,
        stage_key: v.status === 'interviewing' ? v.stage_key : undefined,
        decision_reason: v.status === 'rejected' ? v.decision_reason.trim() : undefined,
        note: v.note?.trim() || undefined,
      })
      .subscribe({
        next: (updated) => {
          this.notify.success('Application updated.');
          this.activeApplication.set(updated);
          this.submitting.set(false);
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  protected submitRating(): void {
    const app = this.activeApplication();
    if (!app) return;
    this.submitting.set(true);
    this.jobs.rateApplication(app.uuid, Number(this.ratingForm.controls.rating.value)).subscribe({
      next: (updated) => {
        this.notify.success('Rating saved.');
        this.activeApplication.set(updated);
        this.submitting.set(false);
        this.list.reload();
      },
      error: () => this.submitting.set(false),
    });
  }

  protected submitNote(): void {
    const app = this.activeApplication();
    if (!app) return;
    if (this.noteForm.invalid) {
      markAllAsTouched(this.noteForm);
      return;
    }
    this.submitting.set(true);
    this.jobs.addApplicationNote(app.uuid, this.noteForm.controls.note.value.trim()).subscribe({
      next: (updated) => {
        this.notify.success('Note added.');
        this.activeApplication.set(updated);
        this.noteForm.reset({ note: '' });
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }

  private async confirmDelete(app: JobApplication): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete application',
      message: `Delete ${app.candidate_name}'s application (${app.application_number})? Their files will be removed. This cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.jobs.removeApplication(app.uuid).subscribe({
      next: () => {
        this.notify.success('Application deleted.');
        if (this.activeApplication()?.uuid === app.uuid) this.closeDrawer();
        this.list.reload();
      },
    });
  }

  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        )
      : '—';
  }

  protected eventText(entryType: string, from: string | null, to: string | null): string {
    switch (entryType) {
      case 'created':
        return 'Application submitted';
      case 'status_changed':
        return `Status changed ${from ? this.labelFor(from) + ' → ' : ''}${this.labelFor(to)}`;
      case 'stage_changed':
        return `Interview round: ${this.roundName(to)}`;
      case 'rating_updated':
        return `Rating set to ${to} ★`;
      case 'note_added':
        return 'Note added';
      default:
        return entryType;
    }
  }

  private labelFor(status: string | null): string {
    if (!status) return '';
    return APPLICATION_STATUS_LABELS[status as ApplicationStatus] ?? status;
  }
}
