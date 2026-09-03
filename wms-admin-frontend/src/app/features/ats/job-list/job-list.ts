import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { RichTextEditorComponent } from '../../../shared/components/rich-text-editor/rich-text-editor.component';
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
import {
  ATS_PERMISSIONS,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  JOB_CURRENCY_OPTIONS,
  JOB_STATUS_LABELS,
  JOB_STATUS_OPTIONS,
  SALARY_PERIOD_OPTIONS,
  WORK_MODE_LABELS,
  WORK_MODE_OPTIONS,
  type CreateJobRequest,
  type InterviewRoundInput,
  type Job,
  type JobStatus,
} from '../models/ats.model';

/** Default interview pipeline pre-filled when creating a job (recruiter can edit). */
const DEFAULT_ROUNDS = ['Screening', 'Technical Interview', 'Managerial Round', 'HR Round'];

/**
 * Jobs list page (ATS home for recruiters + org admins).
 *
 * Visibility is scoped server-side: a recruiter sees only their own postings, an org
 * admin sees the whole org. This page gates ACTIONS by capability for UX only; the
 * backend re-enforces every rule. Creating/editing a job manages the interview pipeline
 * as a dynamic FormArray. Opening a job navigates to its detail (applicants) page.
 */
@Component({
  selector: 'app-job-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    DataTableComponent,
    RichTextEditorComponent,
  ],
  templateUrl: './job-list.html',
  styleUrl: './job-list.scss',
})
export class JobList {
  private readonly fb = inject(FormBuilder);
  private readonly jobs = inject(JobsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly router = inject(Router);

  protected readonly statusLabels = JOB_STATUS_LABELS;
  protected readonly employmentLabels = EMPLOYMENT_TYPE_LABELS;
  protected readonly workModeLabels = WORK_MODE_LABELS;
  protected readonly employmentOptions = EMPLOYMENT_TYPE_OPTIONS;
  protected readonly workModeOptions = WORK_MODE_OPTIONS;
  protected readonly currencyOptions = JOB_CURRENCY_OPTIONS;
  protected readonly salaryPeriodOptions = SALARY_PERIOD_OPTIONS;

  protected readonly canCreate = computed(() => this.auth.hasPermission(ATS_PERMISSIONS.jobCreate));
  protected readonly canUpdate = computed(() => this.auth.hasPermission(ATS_PERMISSIONS.jobUpdate));
  protected readonly canDelete = computed(() => this.auth.hasPermission(ATS_PERMISSIONS.jobDelete));

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');
  /** 'create' | 'edit' | null */
  protected readonly openModal = signal<'create' | 'edit' | null>(null);
  protected readonly activeJob = signal<Job | null>(null);

  protected readonly list = createListState<Job>((query) => this.jobs.list(query), {
    sortBy: 'created_at',
    sortDir: 'desc',
    limit: 10,
  });

  protected readonly columns: ReadonlyArray<DataTableColumn<Job>> = [
    { key: 'job_code', label: 'Code', value: (j) => j.job_code, tone: 'code' },
    { key: 'title', label: 'Title', sortable: true, value: (j) => j.title },
    { key: 'department', label: 'Department', value: (j) => j.department || '—' },
    { key: 'location', label: 'Location', value: (j) => j.location || '—' },
    {
      key: 'employment_type',
      label: 'Type',
      value: (j) => this.employmentLabels[j.employment_type],
    },
    { key: 'openings', label: 'Openings', value: (j) => String(j.openings), tone: 'code' },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (j) => this.statusLabels[j.status],
      badge: (j) => ({
        label: this.statusLabels[j.status],
        variant: this.statusVariant(j.status),
        dot: true,
      }),
    },
  ];

  private statusVariant(status: JobStatus): BadgeVariant {
    switch (status) {
      case 'draft':
        return 'neutral';
      case 'open':
        return 'success';
      case 'closed':
        return 'warning';
      case 'filled':
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
        ...JOB_STATUS_OPTIONS.map((s) => ({ label: JOB_STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'employment_type',
      label: 'Type',
      options: [
        { label: 'All types', value: '' },
        ...EMPLOYMENT_TYPE_OPTIONS.map((t) => ({ label: EMPLOYMENT_TYPE_LABELS[t], value: t })),
      ],
    },
    {
      key: 'work_mode',
      label: 'Work mode',
      options: [
        { label: 'All modes', value: '' },
        ...WORK_MODE_OPTIONS.map((m) => ({ label: WORK_MODE_LABELS[m], value: m })),
      ],
    },
  ]);

  protected readonly actions = computed<ReadonlyArray<DataTableAction<Job>>>(() => {
    const acts: DataTableAction<Job>[] = [
      { id: 'view', label: 'View applicants', icon: 'view' },
      { id: 'copy', label: 'Copy public link', icon: 'externalLink' },
    ];
    if (this.canUpdate()) {
      acts.push({ id: 'edit', label: 'Edit', icon: 'edit' });
      acts.push({
        id: 'publish',
        label: 'Publish',
        icon: 'submit',
        isHidden: (j) => j.status !== 'draft' && j.status !== 'closed' && j.status !== 'filled',
        disabledLabel: () => 'Only a draft or closed/filled job can be opened',
      });
      acts.push({
        id: 'close',
        label: 'Close',
        icon: 'cancel',
        isHidden: (j) => j.status !== 'open',
      });
      acts.push({
        id: 'fill',
        label: 'Mark filled',
        icon: 'check',
        isHidden: (j) => j.status !== 'open',
      });
    }
    if (this.canDelete()) {
      acts.push({
        id: 'delete',
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
        isDisabled: (j) => j.status !== 'draft',
        disabledLabel: () => 'Only a draft job with no applications can be deleted',
      });
    }
    return acts;
  });

  // ── Job form (shared shape for create + edit) ──────────────────────────────
  protected readonly jobForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', [Validators.required, Validators.maxLength(20000)]],
    department: [''],
    location: [''],
    employment_type: ['full_time'],
    work_mode: ['onsite'],
    experience_min: [null as number | null],
    experience_max: [null as number | null],
    salary_min: [null as number | null],
    salary_max: [null as number | null],
    currency: ['USD'],
    salary_period: ['yearly'],
    show_salary: [false],
    openings: [1, [Validators.required, Validators.min(1)]],
    skills: [''], // comma-separated in the UI, split on submit
    rounds: this.fb.array<ReturnType<JobList['createRoundControl']>>([]),
  });

  protected get rounds(): FormArray {
    return this.jobForm.get('rounds') as FormArray;
  }

  private createRoundControl(name = '') {
    return this.fb.nonNullable.group({
      name: [name, [Validators.required, Validators.maxLength(120)]],
    });
  }

  constructor() {
    this.list.init();
  }

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  // ── Round pipeline editing ─────────────────────────────────────────────────
  protected addRound(name = ''): void {
    this.rounds.push(this.createRoundControl(name));
  }

  protected removeRound(index: number): void {
    this.rounds.removeAt(index);
  }

  private setRounds(names: string[]): void {
    this.rounds.clear();
    names.forEach((n) => this.addRound(n));
  }

  // ── Open modals ─────────────────────────────────────────────────────────────
  protected openCreate(): void {
    this.activeJob.set(null);
    this.jobForm.reset({
      title: '',
      description: '',
      department: '',
      location: '',
      employment_type: 'full_time',
      work_mode: 'onsite',
      experience_min: null,
      experience_max: null,
      salary_min: null,
      salary_max: null,
      currency: 'USD',
      salary_period: 'yearly',
      show_salary: false,
      openings: 1,
      skills: '',
    });
    this.setRounds(DEFAULT_ROUNDS);
    this.openModal.set('create');
  }

  private openEdit(job: Job): void {
    this.activeJob.set(job);
    this.jobForm.reset({
      title: job.title,
      description: job.description,
      department: job.department ?? '',
      location: job.location ?? '',
      employment_type: job.employment_type,
      work_mode: job.work_mode,
      experience_min: job.experience_min,
      experience_max: job.experience_max,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      currency: job.currency ?? 'USD',
      salary_period: job.salary_period ?? 'yearly',
      show_salary: job.show_salary,
      openings: job.openings,
      skills: (job.skills ?? []).join(', '),
    });
    this.setRounds((job.interview_rounds ?? []).map((r) => r.name));
    this.openModal.set('edit');
  }

  protected closeModal(): void {
    this.openModal.set(null);
    this.activeJob.set(null);
  }

  protected onAction(event: { actionId: string; row: Job }): void {
    switch (event.actionId) {
      case 'view':
        this.router.navigate([APP_ROUTES.jobs, event.row.uuid]);
        break;
      case 'copy':
        void this.copyPublicLink(event.row);
        break;
      case 'edit':
        this.openEdit(event.row);
        break;
      case 'publish':
        void this.confirmStatus(event.row, 'open', 'Publish job', 'Publish this job so candidates can apply?');
        break;
      case 'close':
        void this.confirmStatus(event.row, 'closed', 'Close job', 'Stop accepting applications for this job?');
        break;
      case 'fill':
        void this.confirmStatus(event.row, 'filled', 'Mark as filled', 'Mark this position as filled?');
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  private async copyPublicLink(job: Job): Promise<void> {
    try {
      await navigator.clipboard.writeText(job.public_url);
      this.notify.success('Public application link copied to clipboard.');
    } catch {
      this.notify.info(job.public_url);
    }
  }

  // ── Build the payload from the form ────────────────────────────────────────
  private buildPayload(action: 'draft' | 'publish'): CreateJobRequest {
    const v = this.jobForm.getRawValue();
    const skills = (v.skills || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const interview_rounds: InterviewRoundInput[] = this.rounds.controls
      .map((c) => ({ name: String(c.get('name')?.value ?? '').trim() }))
      .filter((r) => r.name.length > 0);
    return {
      action,
      title: v.title.trim(),
      description: v.description.trim(),
      department: v.department?.trim() || null,
      location: v.location?.trim() || null,
      employment_type: v.employment_type as CreateJobRequest['employment_type'],
      work_mode: v.work_mode as CreateJobRequest['work_mode'],
      experience_min: v.experience_min,
      experience_max: v.experience_max,
      salary_min: v.salary_min,
      salary_max: v.salary_max,
      currency: v.currency || null,
      salary_period: v.salary_period as CreateJobRequest['salary_period'],
      show_salary: v.show_salary,
      openings: Number(v.openings),
      skills,
      interview_rounds,
    };
  }

  private validate(action: 'draft' | 'publish'): boolean {
    if (this.jobForm.invalid) {
      markAllAsTouched(this.jobForm);
      return false;
    }
    const v = this.jobForm.getRawValue();
    if (v.experience_min != null && v.experience_max != null && v.experience_min > v.experience_max) {
      this.notify.error('Maximum experience must be greater than or equal to the minimum.');
      return false;
    }
    if (v.salary_min != null && v.salary_max != null && v.salary_min > v.salary_max) {
      this.notify.error('Maximum salary must be greater than or equal to the minimum.');
      return false;
    }
    const roundCount = this.rounds.controls.filter(
      (c) => String(c.get('name')?.value ?? '').trim().length > 0,
    ).length;
    if (action === 'publish' && roundCount === 0) {
      this.notify.error('Add at least one interview round before publishing.');
      return false;
    }
    return true;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  protected submitCreate(action: 'draft' | 'publish'): void {
    if (!this.validate(action)) return;
    this.submitting.set(true);
    this.jobs.create(this.buildPayload(action)).subscribe({
      next: () => {
        this.notify.success(action === 'publish' ? 'Job published.' : 'Draft saved.');
        this.finish();
      },
      error: () => this.submitting.set(false),
    });
  }

  protected submitEdit(action: 'draft' | 'publish'): void {
    const job = this.activeJob();
    if (!job) return;
    if (!this.validate(action)) return;
    const payload = this.buildPayload(action);
    // On edit we don't force a status change here; publishing an edited draft is a
    // separate action. Send the fields (drop `action`).
    delete (payload as { action?: string }).action;
    this.submitting.set(true);
    this.jobs.update(job.uuid, payload).subscribe({
      next: () => {
        this.notify.success(`Job ${job.job_code} updated.`);
        this.finish();
      },
      error: () => this.submitting.set(false),
    });
  }

  private async confirmStatus(
    job: Job,
    status: JobStatus,
    title: string,
    message: string,
  ): Promise<void> {
    const confirmed = await this.modal.confirm({ title, message, confirmText: title });
    if (!confirmed) return;
    this.jobs.changeStatus(job.uuid, status).subscribe({
      next: () => {
        this.notify.success(`Job ${job.job_code} updated.`);
        this.list.reload();
      },
    });
  }

  private async confirmDelete(job: Job): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete job',
      message: `Delete draft job ${job.job_code}? This cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.jobs.remove(job.uuid).subscribe({
      next: () => {
        this.notify.success(`Job ${job.job_code} deleted.`);
        this.list.reload();
      },
    });
  }

  private finish(): void {
    this.submitting.set(false);
    this.closeModal();
    this.list.reload();
  }
}
