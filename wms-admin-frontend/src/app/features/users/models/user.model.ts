/**
 * Rich user + profile models mirroring the backend DTOs.
 *
 * The profile is grouped by the same tabs the create/edit form renders
 * (Work / Private / Contract / Settings), so the form maps 1-to-1 onto this shape.
 */

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface WorkInformation {
  job_title?: string;
  job_position?: string;
  department?: string;
  work_email?: string;
  work_phone?: string;
  work_mobile?: string;
  work_location?: string;
  working_hours?: string;
  work_address?: Address;
}

export interface Citizenship {
  country_of_residence?: string;
  ssn_no?: string;
  gender?: string;
  date_of_birth?: string;
  place_of_birth?: string;
  country_of_birth?: string;
}

export interface EmergencyContact {
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  relation?: string;
}

export interface Education {
  certificate_level?: string;
  field_of_study?: string;
  school?: string;
}

export interface WorkPermit {
  visa_status?: string;
  visa_no?: string;
  visa_type?: string;
  work_permit_no?: string;
  visa_expiration_date?: string | null;
  work_permit_expiration_date?: string | null;
}

/** Bank block as returned by the backend (numbers masked). */
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

/** Lock state for a structured, verifiable profile section. */
export interface SectionLock {
  locked: boolean;
  status: string;
  verified_at: string | null;
  note: string | null;
}

/** Keys of the lockable structured sections. */
export type ProfileSectionKey = 'bank_details' | 'work_authorization' | 'emergency_contact';

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

export interface MonthlyAdvantages {
  hra?: number;
  da?: number;
  travel_allowance?: number;
  meal_allowance?: number;
  medical_allowance?: number;
  other_allowance?: number;
}

export interface Contract {
  contract_reference?: string;
  contract_start_date?: string;
  contract_end_date?: string;
  notice_period_days?: number;
  working_schedule?: string;
  contract_type?: string;
  wage?: number;
  wage_currency?: string;
  monthly_advantages?: MonthlyAdvantages;
}

export interface ProfileSettings {
  employee_type?: string;
  joining_date?: string;
}

export interface UserProfile {
  profile_completed?: boolean;
  employee_type?: string;
  vendor_id?: number | null;
  bank_details?: BankDetailsDto;
  section_locks?: Record<ProfileSectionKey, SectionLock>;
  work_information: WorkInformation;
  private_information: PrivateInformation;
  contract: Contract;
  settings: ProfileSettings;
}

export interface UserDocument {
  uuid: string | null;
  doc_type: string;
  label: string;
  required?: boolean;
  /** True once an admin verifies it (locked). */
  locked?: boolean;
  /** Optional link to a blank sample the user downloads, fills, and re-uploads. */
  sample_url?: string | null;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  file_name?: string | null;
  file_mime?: string | null;
  file_size?: number | null;
  /** Delivery link to the uploaded file (for the admin to view). */
  file_url?: string | null;
  expires_on?: string | null;
  uploaded_at?: string | null;
  note?: string | null;
}

/** Body for the admin document approve/reject/unlock call. */
export interface DocumentStatusPayload {
  status: 'verified' | 'rejected' | 'uploaded' | 'pending';
  note?: string;
}

/** Body for the admin section lock/unlock call. */
export interface SectionStatusPayload {
  section: ProfileSectionKey;
  status: 'verified' | 'unverified';
  note?: string;
}

export interface VendorProfile {
  uuid: string;
  company_name: string;
  tax_id?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  address?: Address;
  website?: string;
  is_active?: boolean;
}

/** Full user detail returned by GET /users/:uuid. */
export interface UserDetail {
  id: number;
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  organization_id: number | null;
  manager_id: number | null;
  created_at?: string;
  role?: { key: string; name: string };
  organization?: { uuid: string; name: string };
  profile: UserProfile | null;
  documents?: UserDocument[];
  vendor_profile: VendorProfile | null;
}

/** One initial leave-balance grant sent with a new user (Time Off tab). */
export interface LeaveAllocationInput {
  /** LeaveType uuid (from GET /leaves/types). */
  leave_type: string;
  /** Days granted (absolute allocation) for the period year. */
  allocated: number;
}

/** Payload for POST /users. */
export interface CreateUserPayload {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  organization_id?: number;
  /** For a C2C consultant: the vendor they work through (chosen from the org vendors). */
  vendor_uuid?: string;
  profile?: Partial<{
    work_information: WorkInformation;
    private_information: PrivateInformation;
    contract: Contract;
    settings: ProfileSettings;
  }>;
  vendor_profile?: Partial<VendorProfile>;
  /** Period year for the initial leave grant (defaults to current year on the server). */
  period_year?: number;
  /** Initial time-off allocations the creator assigns to the new user. */
  leave_allocations?: LeaveAllocationInput[];
}

/**
 * Assignable roles surfaced in the create form. These are the backend RBAC role keys
 * (see src/config/rbac.js ASSIGNABLE_ROLES_BY_ROLE). The W2 / 1099 / C2C distinction
 * for consultants is captured by the profile `employee_type`, not a separate role.
 */
export const ASSIGNABLE_ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'consultant_w2', label: 'Consultant (W2)' },
  { value: 'consultant_1099', label: 'Consultant (1099)' },
  { value: 'consultant_c2c', label: 'Consultant (C2C)' },
  { value: 'vendor', label: 'Vendor' },
  // Recruiter: runs the ATS (creates jobs, manages candidates). Org admins may assign it.
  { value: 'recruiter', label: 'Recruiter' },
];

/** Vendor summary for the C2C "select vendor" dropdown (GET /users/vendors). */
export interface VendorOption {
  uuid: string;
  name: string;
  company_name: string | null;
}

/** Contract-type options (aligned with the consultant engagement types). */
export const CONTRACT_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'w2', label: 'W2' },
  { value: '1099', label: '1099' },
  { value: 'c2c', label: 'C2C' },
];

/** Tooltip help text for the monthly-advantage fields (shown on hover). */
export const ADVANTAGE_TOOLTIPS: Record<string, string> = {
  hra: 'House Rent Allowance',
  da: 'Dearness Allowance',
  travel_allowance: 'Travel / conveyance allowance',
  meal_allowance: 'Meal / food allowance',
  medical_allowance: 'Medical allowance',
  other_allowance: 'Any other cash allowance',
};

/** Employee-type classification, aligned with the backend profile `employee_type`. */
export const EMPLOYEE_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'w2', label: 'W2 Employee' },
  { value: '1099', label: '1099 Contractor' },
  { value: 'c2c', label: 'C2C (Corp-to-Corp)' },
  { value: 'employee', label: 'Employee' },
  { value: 'vendor', label: 'Vendor' },
];
