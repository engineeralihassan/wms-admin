import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';
import {
  mb,
  type FileUploadConfig,
} from '../../../shared/components/file-upload/file-upload.model';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { CareersService } from '../../ats/services/careers.service';
import {
  EMPLOYMENT_TYPE_LABELS,
  SALARY_PERIOD_LABELS,
  WORK_MODE_LABELS,
  type ApplyAcknowledgement,
  type PublicJob,
} from '../../ats/models/ats.model';

/**
 * PUBLIC careers page (no authentication). Rendered outside the admin layout at
 * /careers/:token. Three states:
 *   - loading  — resolving the token.
 *   - not found / unavailable — a friendly "position filled / no longer accepting"
 *     message (the backend returns available:false + a reason, or 404 for unknown).
 *   - available — the full job description + an application form with CV upload.
 *
 * On successful submit it shows a thank-you acknowledgement with the reference number.
 */
@Component({
  selector: 'app-careers-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, FileUploadComponent],
  templateUrl: './careers-page.html',
  styleUrl: './careers-page.scss',
})
export class CareersPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly careers = inject(CareersService);

  /** Route param bound via withComponentInputBinding(). */
  readonly token = input.required<string>();

  protected readonly employmentLabels = EMPLOYMENT_TYPE_LABELS;
  protected readonly workModeLabels = WORK_MODE_LABELS;
  protected readonly salaryPeriodLabels = SALARY_PERIOD_LABELS;

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly job = signal<PublicJob | null>(null);
  protected readonly submitting = signal(false);
  protected readonly acknowledgement = signal<ApplyAcknowledgement | null>(null);

  protected readonly available = computed(() => this.job()?.available === true);

  /** Config for the CV/attachment uploader (PDF/Word/images, <=5MB, up to 5 files). */
  protected readonly cvConfig: FileUploadConfig = {
    accept: ['pdf', 'doc', 'image'],
    maxSizeBytes: mb(5),
    maxFiles: 5,
  };
  protected readonly cvFiles = signal<File[]>([]);

  protected readonly form = this.fb.nonNullable.group({
    candidate_name: ['', [Validators.required, Validators.maxLength(150)]],
    candidate_email: ['', [Validators.required, Validators.email]],
    candidate_phone: [''],
    linkedin_url: [''],
    portfolio_url: [''],
    experience_years: [null as number | null],
    cover_note: ['', [Validators.maxLength(5000)]],
  });

  ngOnInit(): void {
    // Route input (token) is bound before ngOnInit runs — reading it in the constructor
    // throws NG0950 (input required but not yet available) and blanks the page.
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.careers.getPublicJob(this.token()).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  /** Friendly headline for an unavailable posting. */
  protected unavailableMessage(): string {
    const reason = this.job()?.unavailable_reason;
    if (reason === 'filled') {
      return 'This position has been filled.';
    }
    return 'This position is no longer accepting applications.';
  }

  protected salaryText(): string {
    const salary = this.job()?.salary;
    if (!salary) return '';
    const cur = salary.currency ?? '';
    const parts: string[] = [];
    if (salary.min != null) parts.push(`${cur} ${salary.min.toLocaleString()}`);
    if (salary.max != null) parts.push(`${cur} ${salary.max.toLocaleString()}`);
    const range = parts.join(' – ');
    const period = salary.period ? ' ' + this.salaryPeriodLabels[salary.period] : '';
    return `${range}${period}`.trim();
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }
    if (this.cvFiles().length === 0) {
      return; // template shows the CV-required hint
    }
    const v = this.form.getRawValue();
    this.submitting.set(true);
    this.careers
      .apply(
        this.token(),
        {
          candidate_name: v.candidate_name.trim(),
          candidate_email: v.candidate_email.trim(),
          candidate_phone: v.candidate_phone?.trim() || undefined,
          linkedin_url: v.linkedin_url?.trim() || undefined,
          portfolio_url: v.portfolio_url?.trim() || undefined,
          experience_years: v.experience_years ?? undefined,
          cover_note: v.cover_note?.trim() || undefined,
        },
        this.cvFiles(),
      )
      .subscribe({
        next: (ack) => {
          this.acknowledgement.set(ack);
          this.submitting.set(false);
        },
        error: () => this.submitting.set(false),
      });
  }
}
