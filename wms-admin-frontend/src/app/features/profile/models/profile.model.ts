/**
 * Self-service profile models — mirror the backend DTOs returned by
 * GET /auth/me/profile and GET /auth/me/documents.
 *
 * Reuses the rich user/profile shapes from the users feature where they match, and
 * adds the profile-page-specific pieces (visa status enum, masked bank block, section
 * locks, document lock/sample metadata).
 */
import type {
  Address,
  Citizenship,
  EmergencyContact,
  Education,
  WorkInformation,
  Contract,
  ProfileSettings,
} from '../../users/models/user.model';

// ── Visa / work authorization ────────────────────────────────────────────────

/** Canonical visa statuses (mirror src/config/profile.constants.js VISA_STATUSES). */
export type VisaStatus =
  | 'us_citizen'
  | 'green_card'
  | 'gc_ead'
  | 'h1b'
  | 'h4_ead'
  | 'l1'
  | 'l2_ead'
  | 'opt_f1'
  | 'cpt_f1'
  | 'tn'
  | 'other';

export interface VisaStatusOption {
  value: VisaStatus;
  label: string;
  /** When false, the expiration date field is hidden (permanent statuses). */
  requiresExpiry: boolean;
  /** When true, a work-authorization document is expected. */
  requiresDocument: boolean;
  /**
   * The document slots this status ADDS on top of the always-required base docs.
   * Metadata-driven so the Work Authorization section is generic: add a status here
   * (or wire it to a per-tenant/region config later) with the docs it needs, and the
   * UI renders them without any code change.
   */
  documents: string[];
}

/**
 * Document slots that ALWAYS appear in the Work Authorization section, regardless of
 * visa status (e.g. tax form + government ID). Kept separate from the per-status docs
 * so the section is fully data-driven.
 */
export const WORK_AUTH_BASE_DOCUMENTS: ReadonlyArray<string> = ['w4_form', 'state_issued_id'];

/** Dropdown options + conditional-field rules (kept in sync with the backend meta). */
export const VISA_STATUS_OPTIONS: ReadonlyArray<VisaStatusOption> = [
  { value: 'us_citizen', label: 'U.S. Citizen', requiresExpiry: false, requiresDocument: false, documents: [] },
  { value: 'green_card', label: 'Green Card Holder', requiresExpiry: false, requiresDocument: false, documents: [] },
  { value: 'gc_ead', label: 'Green Card EAD', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'h1b', label: 'H-1B', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'h4_ead', label: 'H-4 EAD', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'l1', label: 'L-1', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'l2_ead', label: 'L-2 EAD', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'opt_f1', label: 'F-1 OPT', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'cpt_f1', label: 'F-1 CPT', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'tn', label: 'TN', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
  { value: 'other', label: 'Other', requiresExpiry: true, requiresDocument: true, documents: ['work_authorization'] },
];

/** Look up the full option metadata for a visa status value. */
export function visaStatusOption(status?: string | null): VisaStatusOption | undefined {
  return VISA_STATUS_OPTIONS.find((o) => o.value === status);
}

/** True if the given visa status needs an expiration date (unknown -> treated as time-bound). */
export function visaRequiresExpiry(status?: string | null): boolean {
  const opt = visaStatusOption(status);
  return opt ? opt.requiresExpiry : !!status;
}

/**
 * Resolve the ordered list of document slots the Work Authorization section should
 * show for a given visa status: the status-specific docs first (e.g. EAD), then the
 * always-required base docs (W-4, State ID). Fully metadata-driven.
 */
export function workAuthDocumentTypes(status?: string | null): string[] {
  const statusDocs = visaStatusOption(status)?.documents ?? [];
  return [...statusDocs, ...WORK_AUTH_BASE_DOCUMENTS];
}

/** Human label for a visa status value. */
export function visaStatusLabel(status?: string | null): string {
  return visaStatusOption(status)?.label ?? (status ?? '');
}

/** Work-permit block (extended with visa_status). */
export interface WorkPermit {
  visa_status?: VisaStatus | '';
  visa_no?: string;
  visa_type?: string;
  work_permit_no?: string;
  visa_expiration_date?: string | null;
  work_permit_expiration_date?: string | null;
}

// ── Bank details ─────────────────────────────────────────────────────────────

export type BankAccountType = 'checking' | 'savings';

export const BANK_ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{ value: BankAccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
];

/** Bank block as SENT to the server (raw numbers). */
export interface BankDetailsInput {
  bank_name?: string;
  account_holder_name?: string;
  account_type?: BankAccountType | '';
  routing_number?: string;
  account_number?: string;
  cheque_document_id?: string | null;
}

/** Bank block as RETURNED by the server (numbers masked, never raw). */
export interface BankDetailsDto {
  bank_name: string | null;
  account_holder_name: string | null;
  account_type: string | null;
  routing_number_masked: string | null;
  account_number_masked: string | null;
  cheque_document_id: string | null;
  has_routing_number: boolean;
  has_account_number: boolean;
}

// ── Section locks ────────────────────────────────────────────────────────────

export type ProfileSectionKey = 'bank_details' | 'work_authorization' | 'emergency_contact';

export interface SectionLock {
  locked: boolean;
  status: 'verified' | 'unverified' | string;
  verified_at: string | null;
  note: string | null;
}

export type SectionLocks = Record<ProfileSectionKey, SectionLock>;

// ── Private information (extended work_permit) ───────────────────────────────

export interface PrivateInformation {
  private_address?: Address;
  private_email?: string;
  private_phone?: string;
  identification_no?: string;
  passport_no?: string;
  citizenship?: Citizenship;
  emergency_contact?: EmergencyContact;
  education?: Education;
  work_permit?: WorkPermit;
}

/** The self-service profile shape returned inside the user DTO. */
export interface MyProfile {
  profile_completed?: boolean;
  employee_type?: string;
  vendor_id?: number | null;
  bank_details: BankDetailsDto;
  section_locks: SectionLocks;
  work_information: WorkInformation;
  private_information: PrivateInformation;
  contract: Contract;
  settings: ProfileSettings;
}

/** GET /auth/me/profile returns the full user DTO with the nested profile. */
export interface MyProfileResponse {
  id: number;
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  role?: { key: string; name: string };
  organization?: { uuid: string; name: string };
  profile: MyProfile | null;
  documents?: ProfileDocument[];
}

/** One document slot in the self-service checklist (GET /auth/me/documents). */
export interface ProfileDocument {
  uuid: string | null;
  doc_type: string;
  label: string;
  required: boolean;
  sample_url: string | null;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  locked: boolean;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  file_url: string | null;
  expires_on: string | null;
  uploaded_at: string | null;
  note: string | null;
}

/** The partial payload sent to PATCH /auth/me/profile (only touched sections). */
export interface UpdateMyProfilePayload {
  work_information?: Partial<WorkInformation>;
  private_information?: Partial<PrivateInformation>;
  contract?: Partial<Contract>;
  settings?: Partial<ProfileSettings>;
  bank_details?: BankDetailsInput;
}
