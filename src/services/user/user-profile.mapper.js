const { CONSULTANT_ROLES, ROLES } = require('../../config/rbac');
const { USER_DOCUMENT_CATALOGUE } = require('../../config/user-documents');
const { PROFILE_SECTIONS } = require('../../config/profile.constants');

/**
 * Maps the validated `profile` payload (nested, UI-shaped) onto UserProfile columns.
 *
 * The API accepts a friendly nested shape grouped by tab (work / private / contract /
 * settings); this flattens it to the model's columns + JSONB blocks. Only keys present
 * in the payload are written, so partial updates never clobber unrelated fields.
 *
 * Returns a plain object suitable for UserProfile.create / .update.
 */
const buildProfileAttributes = (profile = {}) => {
  const out = {};
  const set = (key, value) => {
    if (value !== undefined) out[key] = value;
  };

  const work = profile.work_information || {};
  set('job_title', work.job_title);
  set('job_position', work.job_position);
  set('department', work.department);
  set('work_email', work.work_email);
  set('work_phone', work.work_phone);
  set('work_mobile', work.work_mobile);
  set('work_location', work.work_location);
  set('working_hours', work.working_hours);
  if (work.work_address !== undefined) out.work_address = work.work_address || {};

  const priv = profile.private_information || {};
  if (priv.private_address !== undefined) out.private_address = priv.private_address || {};
  set('private_email', priv.private_email);
  set('private_phone', priv.private_phone);
  set('identification_no', priv.identification_no);
  set('passport_no', priv.passport_no);
  if (priv.citizenship !== undefined) out.citizenship = priv.citizenship || {};
  if (priv.emergency_contact !== undefined) out.emergency_contact = priv.emergency_contact || {};
  if (priv.education !== undefined) out.education = priv.education || {};
  if (priv.work_permit !== undefined) out.work_permit = priv.work_permit || {};

  // Bank details live at the top level of the friendly payload (their own tab/section).
  if (profile.bank_details !== undefined) out.bank_details = profile.bank_details || {};

  const contract = profile.contract || {};
  set('contract_reference', contract.contract_reference);
  set('contract_start_date', contract.contract_start_date);
  set('contract_end_date', contract.contract_end_date);
  set('notice_period_days', contract.notice_period_days);
  set('working_schedule', contract.working_schedule);
  set('contract_type', contract.contract_type);
  set('wage', contract.wage);
  set('wage_currency', contract.wage_currency);
  if (contract.monthly_advantages !== undefined) {
    out.monthly_advantages = contract.monthly_advantages || {};
  }

  const settings = profile.settings || {};
  set('employee_type', settings.employee_type);
  set('joining_date', settings.joining_date);

  return out;
};

/**
 * Default employee_type derived from the assigned role, so the profile is
 * self-describing even if the admin doesn't set it explicitly.
 */
const defaultEmployeeTypeForRole = (roleKey) => {
  switch (roleKey) {
    case ROLES.CONSULTANT_W2:
      return 'w2';
    case ROLES.CONSULTANT_C2C:
      return 'c2c';
    case ROLES.CONSULTANT_1099:
      return '1099';
    case ROLES.VENDOR:
      return 'vendor';
    case ROLES.ORG_ADMIN:
      return 'employee';
    default:
      return null;
  }
};

const isConsultantRole = (roleKey) => CONSULTANT_ROLES.includes(roleKey);

/**
 * The initial set of document "slots" seeded for a new user. Rows start as 'pending'
 * (expected but not yet uploaded) so the FE can render the checklist the consultant
 * fills in after logging in. Admin side stays empty (no files) by design.
 */
const buildInitialDocumentRows = (userId, organizationId) =>
  USER_DOCUMENT_CATALOGUE.map((doc) => ({
    user_id: userId,
    organization_id: organizationId,
    doc_type: doc.type,
    label: doc.label,
    status: 'pending',
    uploaded_by_id: null,
  }));

/**
 * Maps a friendly profile payload to the STRUCTURED sections it would write, so the
 * lock guard can tell which locked sections a self-service update is trying to touch.
 * Returns the set of PROFILE_SECTIONS keys present in the payload.
 */
const sectionsTouchedByPayload = (profile = {}) => {
  const touched = new Set();
  if (profile.bank_details !== undefined) touched.add(PROFILE_SECTIONS.BANK_DETAILS);
  const priv = profile.private_information || {};
  if (priv.work_permit !== undefined) touched.add(PROFILE_SECTIONS.WORK_AUTHORIZATION);
  if (priv.emergency_contact !== undefined) touched.add(PROFILE_SECTIONS.EMERGENCY_CONTACT);
  return [...touched];
};

/** Is a structured section currently locked (admin-verified) on this profile? */
const isSectionLocked = (profile, sectionKey) => {
  const map = (profile && profile.verified_sections) || {};
  const entry = map[sectionKey];
  return !!(entry && entry.status === 'verified');
};

module.exports = {
  buildProfileAttributes,
  defaultEmployeeTypeForRole,
  isConsultantRole,
  buildInitialDocumentRows,
  sectionsTouchedByPayload,
  isSectionLocked,
};
