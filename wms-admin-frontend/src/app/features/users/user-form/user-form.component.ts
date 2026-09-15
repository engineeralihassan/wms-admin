import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import { NotificationService } from '../../../core/services/notification.service';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { UsersService } from '../services/users.service';
import { LeavesService } from '../../leaves/services/leaves';
import type { LeaveType } from '../../leaves/models/leave.model';
import {
  ADVANTAGE_TOOLTIPS,
  ASSIGNABLE_ROLE_OPTIONS,
  CONTRACT_TYPE_OPTIONS,
  EMPLOYEE_TYPE_OPTIONS,
  type CreateUserPayload,
  type LeaveAllocationInput,
  type ProfileSectionKey,
  type UserDetail,
  type UserDocument,
  type VendorOption,
} from '../models/user.model';
import { VISA_STATUS_OPTIONS } from '../../profile/models/profile.model';

type TabId = 'work' | 'private' | 'contract' | 'documents' | 'timeoff' | 'settings';

/** The three ways this one component is used. */
export type UserFormMode = 'create' | 'edit' | 'view';

/**
 * Tabbed create/edit form for a user (Odoo-style, trimmed to the fields we keep).
 *
 * One component serves both modes:
 *  - Create (no `uuid`): identity + role are required; profile fields are optional
 *    and can be completed later by the user after they activate. Submitting sends the
 *    whole nested payload to POST /users; an activation email is queued by the backend.
 *  - Edit (with `uuid`): loads the user, updates identity via PATCH /users/:uuid and
 *    the profile via PATCH /users/:uuid/profile.
 *
 * The Documents tab is intentionally read-only here on the admin side — it shows the
 * checklist the consultant will fill in after logging in.
 */
@Component({
  selector: 'app-user-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    ButtonComponent,
    SpinnerComponent,
    ModalComponent,
  ],
  templateUrl: './user-form.component.html',
  styleUrl: './user-form.component.scss',
})
export class UserFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly users = inject(UsersService);
  private readonly leaves = inject(LeavesService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Present in edit/view mode (bound from the `:uuid` route segment). */
  readonly uuid = input<string | undefined>(undefined);

  /**
   * create | edit | view. Read from the route's static `data.mode` (robust —
   * doesn't depend on input-binding-from-data). Falls back to inferring from the URL.
   */
  protected readonly mode = signal<UserFormMode>(this.resolveMode());

  private resolveMode(): UserFormMode {
    const dataMode = this.route.snapshot.data?.['mode'] as UserFormMode | undefined;
    if (dataMode) return dataMode;
    // Fallback from the URL shape: /users/new, /users/:uuid/edit, /users/:uuid
    const url = this.route.snapshot.url.map((s) => s.path);
    if (url.includes('new')) return 'create';
    if (url.includes('edit')) return 'edit';
    return this.route.snapshot.paramMap.get('uuid') ? 'view' : 'create';
  }

  protected readonly isEdit = computed(() => this.mode() === 'edit');
  protected readonly isView = computed(() => this.mode() === 'view');
  /** True when we're loading an existing user (edit or view). */
  protected readonly isExisting = computed(() => this.mode() !== 'create');
  protected readonly loading = signal(false);
  protected readonly submitting = signal(false);
  protected readonly activeTab = signal<TabId>('work');
  protected readonly usersHome = APP_ROUTES.users;

  protected readonly roleOptions = ASSIGNABLE_ROLE_OPTIONS;
  protected readonly employeeTypeOptions = EMPLOYEE_TYPE_OPTIONS;
  protected readonly contractTypeOptions = CONTRACT_TYPE_OPTIONS;
  protected readonly advantageTooltips = ADVANTAGE_TOOLTIPS;
  protected readonly visaStatusOptions = VISA_STATUS_OPTIONS;

  // ── View-mode (admin verification) state ─────────────────────────────────────
  /** The loaded user (view mode) — carries section_locks + bank masked values. */
  protected readonly detail = signal<UserDetail | null>(null);
  protected readonly busyDoc = signal<string | null>(null);
  protected readonly busySection = signal<ProfileSectionKey | null>(null);

  protected readonly sectionLocks = computed(
    () => this.detail()?.profile?.section_locks ?? null,
  );

  // Reject-reason modal
  protected readonly rejectOpen = signal(false);
  protected readonly rejectReason = signal('');
  private rejectTarget: UserDocument | null = null;

  /** Vendors in the org, loaded lazily when the C2C role is selected. */
  protected readonly vendors = signal<VendorOption[]>([]);
  /** True when the currently-selected role is C2C (drives the vendor dropdown). */
  protected readonly isC2c = signal(false);

  /** Org leave types, loaded once for the Time Off tab dropdowns. */
  protected readonly leaveTypes = signal<LeaveType[]>([]);
  /** The period year the initial grant applies to (defaults to the current year). */
  protected readonly periodYear = new Date().getFullYear();

  private readonly allTabs: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'work', label: 'Work Information' },
    { id: 'private', label: 'Private Information' },
    { id: 'contract', label: 'Contract' },
    { id: 'documents', label: 'Documents' },
    { id: 'timeoff', label: 'Time Off' },
    { id: 'settings', label: 'Settings' },
  ];

  /** Tabs shown for the current mode (Time Off is a create-time concern). */
  protected readonly tabs = computed(() =>
    this.isView() ? this.allTabs.filter((t) => t.id !== 'timeoff') : this.allTabs,
  );

  protected readonly documents = signal<UserDetail['documents']>([]);

  protected readonly form = this.fb.nonNullable.group({
    // Identity (required)
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    role: ['consultant_w2', [Validators.required]],
    // Only relevant for a C2C consultant; the vendor they work through.
    vendor_uuid: [''],

    // Work information
    work_information: this.fb.nonNullable.group({
      job_title: [''],
      job_position: [''],
      department: [''],
      work_email: [''],
      work_phone: [''],
      work_mobile: [''],
      work_location: [''],
      working_hours: [''],
      work_address: this.fb.nonNullable.group(this.addressControls()),
    }),

    // Private information
    private_information: this.fb.nonNullable.group({
      private_address: this.fb.nonNullable.group(this.addressControls()),
      private_email: [''],
      private_phone: [''],
      identification_no: [''],
      passport_no: [''],
      citizenship: this.fb.nonNullable.group({
        country_of_residence: [''],
        ssn_no: [''],
        gender: [''],
        date_of_birth: [''],
        place_of_birth: [''],
        country_of_birth: [''],
      }),
      emergency_contact: this.fb.nonNullable.group({
        contact_name: [''],
        contact_phone: [''],
        contact_email: [''],
        relation: [''],
      }),
      education: this.fb.nonNullable.group({
        certificate_level: [''],
        field_of_study: [''],
        school: [''],
      }),
      work_permit: this.fb.nonNullable.group({
        visa_status: [''],
        visa_no: [''],
        visa_type: [''],
        work_permit_no: [''],
        visa_expiration_date: [''],
        work_permit_expiration_date: [''],
      }),
    }),

    // Bank details (shown read-only to the admin; numbers arrive masked from the API).
    bank_details: this.fb.nonNullable.group({
      bank_name: [''],
      account_holder_name: [''],
      account_type: [''],
      routing_number: [''],
      account_number: [''],
    }),

    // Contract
    contract: this.fb.nonNullable.group({
      contract_reference: [''],
      contract_start_date: [''],
      contract_end_date: [''],
      notice_period_days: [null as number | null],
      working_schedule: [''],
      contract_type: [''],
      wage: [null as number | null],
      wage_currency: ['USD'],
      monthly_advantages: this.fb.nonNullable.group({
        hra: [null as number | null],
        da: [null as number | null],
        travel_allowance: [null as number | null],
        meal_allowance: [null as number | null],
        medical_allowance: [null as number | null],
        other_allowance: [null as number | null],
      }),
    }),

    // Settings
    settings: this.fb.nonNullable.group({
      employee_type: [''],
      joining_date: [''],
    }),

    // Time Off — initial leave balances the creator assigns to the new user.
    // Each row: { leave_type: <uuid>, allocated: <days> }.
    leave_allocations: this.fb.array<FormGroup>([]),
  });

  /** Typed accessor for the leave_allocations FormArray (used by the template). */
  protected get leaveAllocations(): FormArray<FormGroup> {
    return this.form.controls.leave_allocations as FormArray<FormGroup>;
  }

  constructor() {
    queueMicrotask(() => {
      if (this.isExisting()) this.load();
      else {
        this.onRoleChange(this.form.controls.role.value);
        // Time-off allocation is a create-time concern; load the org's leave types so
        // the creator can seed balances. In edit mode, balances are managed elsewhere.
        this.loadLeaveTypes();
      }
    });
    // React to role changes: show/hide the vendor dropdown and lazy-load vendors.
    this.form.controls.role.valueChanges.subscribe((role) => this.onRoleChange(role));
  }

  /** Load the org leave types once, then seed one empty allocation row for convenience. */
  private loadLeaveTypes(): void {
    this.leaves.listTypes().subscribe({
      next: (types) => {
        this.leaveTypes.set(types);
        if (types.length && this.leaveAllocations.length === 0) this.addAllocation();
      },
    });
  }

  /** Add an empty time-off allocation row. */
  protected addAllocation(): void {
    this.leaveAllocations.push(
      this.fb.nonNullable.group({
        leave_type: ['', [Validators.required]],
        allocated: [null as number | null, [Validators.required, Validators.min(0)]],
      }),
    );
  }

  /** Remove the allocation row at the given index. */
  protected removeAllocation(index: number): void {
    this.leaveAllocations.removeAt(index);
  }

  /** Remove time-off rows the creator left completely blank (no type AND no days). */
  private dropEmptyAllocations(): void {
    for (let i = this.leaveAllocations.length - 1; i >= 0; i -= 1) {
      const { leave_type, allocated } = this.leaveAllocations.at(i).getRawValue() as {
        leave_type?: string;
        allocated?: number | null;
      };
      if (!leave_type && (allocated == null || (allocated as unknown as string) === '')) {
        this.leaveAllocations.removeAt(i);
      }
    }
  }

  /** When C2C is chosen, reveal the vendor dropdown and load the org's vendors once. */
  private onRoleChange(role: string): void {
    const c2c = role === 'consultant_c2c';
    this.isC2c.set(c2c);
    if (c2c && this.vendors().length === 0) {
      this.users.listVendors().subscribe({ next: (v) => this.vendors.set(v) });
    }
    if (!c2c) this.form.controls.vendor_uuid.setValue('');
  }

  private addressControls() {
    return {
      line1: [''],
      line2: [''],
      city: [''],
      state: [''],
      zip: [''],
      country: [''],
    };
  }

  protected setTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  private load(): void {
    const id = this.uuid();
    if (!id) return;
    this.loading.set(true);
    this.users.getDetail(id).subscribe({
      next: (u) => {
        this.detail.set(u);
        this.patchFromDetail(u);
        this.loadDocuments();
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Reload just the documents checklist (after an approve/reject). */
  private loadDocuments(): void {
    const id = this.uuid();
    if (!id) return;
    this.users.listDocuments(id).subscribe({
      next: (docs) => this.documents.set(docs),
    });
  }

  private patchFromDetail(u: UserDetail): void {
    this.form.patchValue({
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      role: u.role?.key ?? 'consultant_c2c',
    });
    if (u.profile) {
      this.form.patchValue({
        work_information: u.profile.work_information as never,
        private_information: u.profile.private_information as never,
        contract: u.profile.contract as never,
        settings: u.profile.settings as never,
      });
      // Bank numbers arrive in full from the API; pre-fill them so the admin can view
      // and edit the real values.
      const bank = u.profile.bank_details;
      if (bank) {
        this.form.controls.bank_details.patchValue({
          bank_name: bank.bank_name ?? '',
          account_holder_name: bank.account_holder_name ?? '',
          account_type: bank.account_type ?? '',
          routing_number: bank.routing_number ?? '',
          account_number: bank.account_number ?? '',
        });
      }
    }

    if (this.isView()) {
      // View = read-only snapshot. Disable EVERY control so nothing can be edited;
      // the admin acts via the verification buttons instead.
      this.form.disable({ emitEvent: false });
    } else {
      // Edit mode: email + role are fixed after creation.
      this.form.controls.email.disable();
      this.form.controls.role.disable();
    }
  }

  /** Strip empty strings/nulls so we never send noise; keeps the payload clean. */
  private prune<T>(obj: T): T {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const cleaned = this.prune(v);
        const empty =
          cleaned === '' ||
          cleaned === null ||
          cleaned === undefined ||
          (typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0);
        if (!empty) out[k] = cleaned;
      }
      return out as T;
    }
    return obj;
  }

  protected submit(): void {
    // Time-off rows are optional. Drop any fully-empty allocation rows so their
    // required-validators don't block an otherwise valid form. Partially-filled rows
    // are kept so the validator nudges the creator to finish (or clear) them.
    this.dropEmptyAllocations();

    if (this.form.invalid) {
      markAllAsTouched(this.form);
      // Point the creator at the tab that actually has the problem.
      this.activeTab.set(this.leaveAllocations.invalid ? 'timeoff' : 'work');
      this.notify.error(
        this.leaveAllocations.invalid
          ? 'Complete or remove the time-off rows (both a leave type and days are required).'
          : 'Please complete the required fields (name, email, role).',
      );
      return;
    }
    const raw = this.form.getRawValue();
    // Bank numbers are shown in full and edited directly, so send them as-is.
    const profile = this.prune({
      work_information: raw.work_information,
      private_information: raw.private_information,
      contract: raw.contract,
      settings: raw.settings,
      bank_details: raw.bank_details,
    });

    this.submitting.set(true);
    if (this.isEdit()) {
      this.saveEdit(raw, profile);
    } else {
      this.saveCreate(raw, profile);
    }
  }

  private saveCreate(raw: ReturnType<typeof this.form.getRawValue>, profile: object): void {
    // Collect the time-off rows the creator filled in: a leave type + a positive
    // number of days. Blank/zero rows are dropped so we never send noise.
    const allocations: LeaveAllocationInput[] = (raw.leave_allocations ?? [])
      .map((row) => row as { leave_type?: string; allocated?: number | null })
      .filter((row) => !!row.leave_type && row.allocated != null && Number(row.allocated) > 0)
      .map((row) => ({ leave_type: row.leave_type as string, allocated: Number(row.allocated) }));

    const payload: CreateUserPayload = {
      first_name: raw.first_name,
      last_name: raw.last_name,
      email: raw.email,
      role: raw.role,
      vendor_uuid: raw.role === 'consultant_c2c' && raw.vendor_uuid ? raw.vendor_uuid : undefined,
      profile: Object.keys(profile).length ? (profile as CreateUserPayload['profile']) : undefined,
      leave_allocations: allocations.length ? allocations : undefined,
      period_year: allocations.length ? this.periodYear : undefined,
    };
    this.users.create(payload).subscribe({
      next: () => {
        this.notify.success('User created. An activation link has been emailed to them.');
        this.submitting.set(false);
        this.router.navigate([this.usersHome]);
      },
      error: () => this.submitting.set(false),
    });
  }

  private saveEdit(raw: ReturnType<typeof this.form.getRawValue>, profile: object): void {
    const id = this.uuid()!;
    this.users.update(id, { first_name: raw.first_name, last_name: raw.last_name }).subscribe({
      next: () => {
        if (Object.keys(profile).length) {
          this.users.updateProfile(id, profile as never).subscribe({
            next: () => {
              this.notify.success('User updated.');
              this.submitting.set(false);
              this.router.navigate([this.usersHome, id]);
            },
            error: () => this.submitting.set(false),
          });
        } else {
          this.notify.success('User updated.');
          this.submitting.set(false);
          this.router.navigate([this.usersHome, id]);
        }
      },
      error: () => this.submitting.set(false),
    });
  }

  protected cancel(): void {
    this.router.navigate([this.usersHome]);
  }

  // ── View mode: navigation + admin verification actions ──────────────────────

  /** Switch from view to the edit form for the same user. */
  protected goToEdit(): void {
    const id = this.uuid();
    if (id) this.router.navigate([this.usersHome, id, 'edit']);
  }

  protected isSectionLocked(key: ProfileSectionKey): boolean {
    return !!this.sectionLocks()?.[key]?.locked;
  }

  private setSection(key: ProfileSectionKey, status: 'verified' | 'unverified'): void {
    const id = this.uuid();
    if (!id) return;
    this.busySection.set(key);
    this.users.setProfileSection(id, { section: key, status }).subscribe({
      next: (u) => {
        this.detail.set(u);
        this.busySection.set(null);
        this.notify.success(status === 'verified' ? 'Section approved and locked.' : 'Section unlocked.');
      },
      error: () => {
        this.busySection.set(null);
        this.notify.error('Could not update the section.');
      },
    });
  }

  protected lockSection(key: ProfileSectionKey): void {
    this.setSection(key, 'verified');
  }

  protected unlockSection(key: ProfileSectionKey): void {
    this.setSection(key, 'unverified');
  }

  private setDocStatus(doc: UserDocument, status: 'verified' | 'uploaded', note?: string): void {
    const id = this.uuid();
    if (!id || !doc.uuid) return;
    this.busyDoc.set(doc.doc_type);
    this.users.setDocumentStatus(id, doc.uuid, { status, note }).subscribe({
      next: () => {
        this.busyDoc.set(null);
        this.loadDocuments();
      },
      error: () => {
        this.busyDoc.set(null);
        this.notify.error('Could not update the document.');
      },
    });
  }

  protected approveDoc(doc: UserDocument): void {
    this.setDocStatus(doc, 'verified');
    this.notify.success(`${doc.label} approved.`);
  }

  protected unlockDoc(doc: UserDocument): void {
    this.setDocStatus(doc, 'uploaded');
    this.notify.success(`${doc.label} unlocked.`);
  }

  /** True when the doc has a file the admin can act on. */
  protected hasFile(doc: UserDocument): boolean {
    return !!doc.uuid && doc.status !== 'pending';
  }

  protected docBadge(status: string): string {
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

  // Reject-reason modal
  protected openReject(doc: UserDocument): void {
    if (!doc.uuid) return;
    this.rejectTarget = doc;
    this.rejectReason.set('');
    this.rejectOpen.set(true);
  }

  protected closeReject(): void {
    this.rejectOpen.set(false);
    this.rejectTarget = null;
    this.rejectReason.set('');
  }

  protected get rejectDocLabel(): string {
    return this.rejectTarget?.label ?? '';
  }

  protected confirmReject(): void {
    const id = this.uuid();
    const doc = this.rejectTarget;
    const note = this.rejectReason().trim();
    if (!id || !doc || !doc.uuid) return;
    if (!note) {
      this.notify.error('Please enter a reason for rejection.');
      return;
    }
    this.busyDoc.set(doc.doc_type);
    this.rejectOpen.set(false);
    this.users.setDocumentStatus(id, doc.uuid, { status: 'rejected', note }).subscribe({
      next: () => {
        this.busyDoc.set(null);
        this.rejectTarget = null;
        this.notify.success(`${doc.label} rejected.`);
        this.loadDocuments();
      },
      error: () => {
        this.busyDoc.set(null);
        this.notify.error('Could not reject the document.');
      },
    });
  }
}
