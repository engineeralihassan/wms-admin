import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CardComponent } from '../../shared/components/card/card.component';
import { SpinnerComponent } from '../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/auth/auth.service';
import { APP_ROUTES } from '../../core/constants/app-routes';
import { ProfileService } from './services/profile.service';
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  VISA_STATUS_OPTIONS,
  visaRequiresExpiry,
  visaStatusLabel,
  workAuthDocumentTypes,
  type MyProfile,
  type MyProfileResponse,
  type ProfileDocument,
  type ProfileSectionKey,
  type UpdateMyProfilePayload,
  type VisaStatus,
} from './models/profile.model';

/** Which section (if any) is currently in inline-edit mode. */
type EditableSection = 'personal' | 'bank' | 'emergency' | 'work_auth' | null;

/**
 * Self-service profile page (`/profile`).
 *
 * Read-first, section-based layout (matching the design): a completion box up top,
 * then cards for Personal, Work, Bank, Emergency Contact, Work Authorization, and the
 * Document checklist. Sections an admin has verified are LOCKED — shown with a lock
 * icon and a "Request change" action that routes the user to raise a ticket. All lock
 * rules are enforced by the backend; the UI mirrors them for a clear experience.
 */
@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CardComponent, SpinnerComponent, ButtonComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private readonly fb = inject(FormBuilder);
  private readonly profileApi = inject(ProfileService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly uploadingType = signal<string | null>(null);
  protected readonly editing = signal<EditableSection>(null);

  protected readonly user = signal<MyProfileResponse | null>(null);
  protected readonly profile = signal<MyProfile | null>(null);
  protected readonly documents = signal<ProfileDocument[]>([]);

  protected readonly visaOptions = VISA_STATUS_OPTIONS;
  protected readonly bankAccountTypes = BANK_ACCOUNT_TYPE_OPTIONS;
  protected readonly visaStatusLabel = visaStatusLabel;

  // ── Derived display values ──────────────────────────────────────────────────

  protected readonly fullName = computed(() => {
    const u = this.user();
    return u ? `${u.first_name} ${u.last_name}` : '';
  });

  protected readonly roleLabel = computed(() => {
    const u = this.user();
    return u?.role?.name ?? '';
  });

  protected readonly initials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  });

  /**
   * Work Authorization edit form. Declared up here (before the signals below) so the
   * field-initializer order is valid: `visaStatusValue` reads this control.
   */
  protected readonly workAuthForm = this.fb.nonNullable.group({
    visa_status: [''],
    visa_no: [''],
    visa_expiration_date: [''],
  });

  /**
   * The live visa status selected in the edit form, as a SIGNAL. A reactive form
   * control's `.value` is NOT reactive to `computed()`, so deriving `showVisaExpiry`
   * straight from the control made the expiration field appear only intermittently
   * (it re-evaluated only when some unrelated signal changed). Bridging the control's
   * valueChanges into a signal makes the conditional field deterministic.
   */
  protected readonly visaStatusValue = toSignal(
    this.workAuthForm.controls.visa_status.valueChanges,
    { initialValue: this.workAuthForm.controls.visa_status.value },
  );

  /** True while the selected visa status needs an expiration date. */
  protected readonly showVisaExpiry = computed(() =>
    visaRequiresExpiry(this.visaStatusValue()),
  );

  /** The visa status currently SAVED on the profile (drives the read-view + doc list). */
  protected readonly savedVisaStatus = computed(
    () => this.profile()?.private_information?.work_permit?.visa_status ?? '',
  );

  /**
   * The ordered document slots the Work Authorization section shows for the saved
   * visa status — status-specific docs (e.g. EAD) first, then the always-required
   * base docs (W-4, State ID). Fully metadata-driven, resolved against the loaded
   * document rows so each carries its upload/lock/sample state.
   */
  protected readonly workAuthDocuments = computed<ProfileDocument[]>(() => {
    const types = workAuthDocumentTypes(this.savedVisaStatus());
    const byType = new Map(this.documents().map((d) => [d.doc_type, d]));
    return types
      .map((t) => byType.get(t))
      .filter((d): d is ProfileDocument => !!d);
  });

  /** Whether a visa status has been chosen yet (gates the rest of the section). */
  protected readonly hasVisaStatus = computed(() => !!this.savedVisaStatus());

  /** Read-view expiry check for a given status (the form-based one is for edit mode). */
  protected showExpiryFor(status?: string | null): boolean {
    return visaRequiresExpiry(status);
  }

  /**
   * Documents shown in the general "Documents" card — everything NOT already surfaced
   * inside the Work Authorization section, so nothing is duplicated.
   */
  protected readonly otherDocuments = computed<ProfileDocument[]>(() => {
    const waTypes = new Set(workAuthDocumentTypes(this.savedVisaStatus()));
    return this.documents().filter((d) => !waTypes.has(d.doc_type));
  });

  // ── Completion summary ──────────────────────────────────────────────────────

  /** One row per tracked profile requirement, for the completion box. */
  protected readonly completionItems = computed(() => {
    const p = this.profile();
    const docs = this.documents();
    if (!p) return [];
    const items: { key: string; label: string; done: boolean }[] = [];

    // Personal contact basics.
    const priv = p.private_information || {};
    items.push({
      key: 'contact',
      label: 'Contact details',
      done: !!(priv.private_phone || p.work_information?.work_phone),
    });

    // Work authorization.
    items.push({
      key: 'work_auth',
      label: 'Work authorization',
      done: !!p.private_information?.work_permit?.visa_status,
    });

    // Bank details.
    items.push({
      key: 'bank',
      label: 'Bank details',
      done: !!(p.bank_details?.bank_name && p.bank_details?.has_account_number),
    });

    // Emergency contact.
    items.push({
      key: 'emergency',
      label: 'Emergency contact',
      done: !!priv.emergency_contact?.contact_name,
    });

    // Required documents.
    for (const d of docs.filter((x) => x.required)) {
      items.push({
        key: `doc_${d.doc_type}`,
        label: d.label,
        done: d.status === 'uploaded' || d.status === 'verified',
      });
    }
    return items;
  });

  protected readonly completionPercent = computed(() => {
    const items = this.completionItems();
    if (!items.length) return 0;
    const done = items.filter((i) => i.done).length;
    return Math.round((done / items.length) * 100);
  });

  // ── Edit forms (one per lockable/editable section) ──────────────────────────

  protected readonly personalForm = this.fb.nonNullable.group({
    private_phone: [''],
    private_email: ['', [Validators.email]],
    line1: [''],
    line2: [''],
    city: [''],
    state: [''],
    zip: [''],
    country: [''],
  });

  protected readonly bankForm = this.fb.nonNullable.group({
    bank_name: [''],
    account_holder_name: [''],
    account_type: [''],
    routing_number: ['', [Validators.pattern(/^[0-9]*$/)]],
    account_number: ['', [Validators.pattern(/^[0-9]*$/)]],
  });

  protected readonly emergencyForm = this.fb.nonNullable.group({
    contact_name: [''],
    relation: [''],
    contact_phone: [''],
    contact_email: ['', [Validators.email]],
  });

  constructor() {
    this.load();
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  private load(): void {
    this.loading.set(true);
    this.profileApi.getMyProfile().subscribe({
      next: (res) => {
        this.user.set(res);
        this.profile.set(res.profile);
        this.hydrateForms(res.profile);
        this.loadDocuments();
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('Could not load your profile.');
        this.loading.set(false);
      },
    });
  }

  private loadDocuments(): void {
    this.profileApi.getMyDocuments().subscribe({
      next: (docs) => this.documents.set(docs),
      error: () => this.notify.error('Could not load your documents.'),
    });
  }

  private hydrateForms(p: MyProfile | null): void {
    if (!p) return;
    const priv = p.private_information || {};
    const addr = priv.private_address || {};
    this.personalForm.reset({
      private_phone: priv.private_phone ?? '',
      private_email: priv.private_email ?? '',
      line1: addr.line1 ?? '',
      line2: addr.line2 ?? '',
      city: addr.city ?? '',
      state: addr.state ?? '',
      zip: addr.zip ?? '',
      country: addr.country ?? '',
    });

    const bank = p.bank_details || ({} as MyProfile['bank_details']);
    this.bankForm.reset({
      bank_name: bank.bank_name ?? '',
      account_holder_name: bank.account_holder_name ?? '',
      account_type: bank.account_type ?? '',
      routing_number: bank.routing_number ?? '',
      account_number: bank.account_number ?? '',
    });

    const ec = priv.emergency_contact || {};
    this.emergencyForm.reset({
      contact_name: ec.contact_name ?? '',
      relation: ec.relation ?? '',
      contact_phone: ec.contact_phone ?? '',
      contact_email: ec.contact_email ?? '',
    });

    const wp = priv.work_permit || {};
    this.workAuthForm.reset({
      visa_status: wp.visa_status ?? '',
      visa_no: wp.visa_no ?? '',
      // <input type="date"> needs an exact YYYY-MM-DD; the stored value may carry a
      // time component (e.g. 2026-09-19T00:00:00.000Z), which the input silently
      // rejects and shows blank. Normalize so the saved date pre-fills on edit.
      visa_expiration_date: this.toDateInputValue(wp.visa_expiration_date),
    });
  }

  /** Coerce any date-ish value to the YYYY-MM-DD an <input type="date"> expects. */
  private toDateInputValue(value?: string | null): string {
    if (!value) return '';
    // Already a plain date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    // Use UTC parts so a date-only value doesn't shift a day across timezones.
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ── Lock helpers ──────────────────────────────────────────────────────────

  protected isLocked(section: ProfileSectionKey): boolean {
    return !!this.profile()?.section_locks?.[section]?.locked;
  }

  protected startEdit(section: EditableSection): void {
    // Don't allow entering edit mode on a locked section.
    if (section === 'bank' && this.isLocked('bank_details')) return;
    if (section === 'emergency' && this.isLocked('emergency_contact')) return;
    if (section === 'work_auth' && this.isLocked('work_authorization')) return;
    this.hydrateForms(this.profile());
    this.editing.set(section);
  }

  protected cancelEdit(): void {
    this.hydrateForms(this.profile());
    this.editing.set(null);
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  protected savePersonal(): void {
    const v = this.personalForm.getRawValue();
    this.save({
      private_information: {
        private_phone: v.private_phone,
        private_email: v.private_email,
        private_address: {
          line1: v.line1,
          line2: v.line2,
          city: v.city,
          state: v.state,
          zip: v.zip,
          country: v.country,
        },
      },
    });
  }

  protected saveBank(): void {
    if (this.bankForm.invalid) {
      this.notify.error('Routing and account numbers must be digits only.');
      return;
    }
    const v = this.bankForm.getRawValue();
    const bank: UpdateMyProfilePayload['bank_details'] = {
      bank_name: v.bank_name,
      account_holder_name: v.account_holder_name,
      account_type: (v.account_type || '') as '' | 'checking' | 'savings',
      routing_number: v.routing_number,
      account_number: v.account_number,
    };
    this.save({ bank_details: bank });
  }

  protected saveEmergency(): void {
    const v = this.emergencyForm.getRawValue();
    this.save({
      private_information: {
        emergency_contact: {
          contact_name: v.contact_name,
          relation: v.relation,
          contact_phone: v.contact_phone,
          contact_email: v.contact_email,
        },
      },
    });
  }

  protected saveWorkAuth(): void {
    const v = this.workAuthForm.getRawValue();
    const needsExpiry = visaRequiresExpiry(v.visa_status);
    // Mirror the backend guard: a time-bound status must carry an expiration date.
    if (v.visa_status && needsExpiry && !v.visa_expiration_date) {
      this.notify.error('Please provide the visa expiration date for this status.');
      return;
    }
    this.save({
      private_information: {
        work_permit: {
          visa_status: (v.visa_status || '') as VisaStatus | '',
          visa_no: v.visa_no,
          // Clear the expiration for permanent statuses (US citizen / green card).
          visa_expiration_date: needsExpiry ? v.visa_expiration_date || null : null,
        },
      },
    });
  }

  private save(payload: UpdateMyProfilePayload): void {
    this.saving.set(true);
    this.profileApi.updateMyProfile(payload).subscribe({
      next: (res) => {
        this.user.set(res);
        this.profile.set(res.profile);
        this.hydrateForms(res.profile);
        this.editing.set(null);
        this.saving.set(false);
        this.notify.success('Profile updated.');
      },
      error: (err) => {
        this.saving.set(false);
        const status = err?.status;
        const msg =
          status === 409
            ? 'This section is locked. Please raise a ticket to request a change.'
            : 'Could not save your changes.';
        this.notify.error(msg);
      },
    });
  }

  // ── Documents ───────────────────────────────────────────────────────────────

  protected onFileSelected(event: Event, doc: ProfileDocument): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (doc.locked) {
      this.notify.error('This document is locked. Please raise a ticket to request a change.');
      return;
    }
    // Work-authorization documents only make sense once a visa status is saved.
    const waTypes = new Set(workAuthDocumentTypes(this.savedVisaStatus()));
    if (waTypes.has(doc.doc_type) && !this.hasVisaStatus()) {
      this.notify.error('Please select and save your visa status before uploading documents.');
      return;
    }
    this.uploadingType.set(doc.doc_type);
    this.profileApi.uploadMyDocument(doc.doc_type, file).subscribe({
      next: () => {
        this.uploadingType.set(null);
        this.notify.success(`${doc.label} uploaded.`);
        this.loadDocuments();
      },
      error: (err) => {
        this.uploadingType.set(null);
        const msg =
          err?.status === 409
            ? 'This document is locked. Please raise a ticket to request a change.'
            : `Could not upload ${doc.label}.`;
        this.notify.error(msg);
      },
    });
  }

  protected statusBadge(status: string): string {
    switch (status) {
      case 'verified':
        return 'Approved';
      case 'uploaded':
        return 'Under review';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Not uploaded';
    }
  }

  // ── Request-change (ticket) flow for locked sections/documents ───────────────

  protected requestChange(subject: string): void {
    this.notify.info('Please raise a ticket describing the change you need — an admin will unlock it.');
    this.router.navigate([APP_ROUTES.tickets], {
      queryParams: { subject: `Request to update: ${subject}` },
    });
  }
}
