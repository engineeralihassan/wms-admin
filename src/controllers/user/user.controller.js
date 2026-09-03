const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { userService, userDocumentService } = require('../../services');

/** Shape the UserProfile row back into the nested, tab-grouped API shape. */
const profileToDto = (p) => {
  if (!p) return null;
  return {
    profile_completed: p.profile_completed,
    employee_type: p.employee_type,
    vendor_id: p.vendor_id,
    work_information: {
      job_title: p.job_title,
      job_position: p.job_position,
      department: p.department,
      work_email: p.work_email,
      work_phone: p.work_phone,
      work_mobile: p.work_mobile,
      work_location: p.work_location,
      working_hours: p.working_hours,
      work_address: p.work_address || {},
    },
    private_information: {
      private_address: p.private_address || {},
      private_email: p.private_email,
      private_phone: p.private_phone,
      identification_no: p.identification_no,
      passport_no: p.passport_no,
      citizenship: p.citizenship || {},
      emergency_contact: p.emergency_contact || {},
      education: p.education || {},
      work_permit: p.work_permit || {},
    },
    contract: {
      contract_reference: p.contract_reference,
      contract_start_date: p.contract_start_date,
      contract_end_date: p.contract_end_date,
      notice_period_days: p.notice_period_days,
      working_schedule: p.working_schedule,
      contract_type: p.contract_type,
      wage: p.wage,
      wage_currency: p.wage_currency,
      monthly_advantages: p.monthly_advantages || {},
    },
    settings: {
      employee_type: p.employee_type,
      joining_date: p.joining_date,
    },
  };
};

const documentToDto = (d) => ({
  uuid: d.uuid,
  doc_type: d.doc_type,
  label: d.label,
  status: d.status,
  file_name: d.file_name,
  file_mime: d.file_mime,
  file_size: d.file_size,
  expires_on: d.expires_on,
  uploaded_at: d.uploaded_at,
  note: d.note,
});

const vendorProfileToDto = (v) =>
  v
    ? {
        uuid: v.uuid,
        company_name: v.company_name,
        tax_id: v.tax_id,
        contact_person: v.contact_person,
        contact_email: v.contact_email,
        contact_phone: v.contact_phone,
        address: v.address || {},
        website: v.website,
        is_active: v.is_active,
      }
    : null;

/** Full user DTO (identity + role + org + nested profile + documents). */
const toDto = (user) => ({
  id: user.id,
  uuid: user.uuid,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  status: user.status,
  organization_id: user.organization_id,
  manager_id: user.manager_id,
  created_at: user.createdAt,
  role: user.role ? { key: user.role.key, name: user.role.name } : undefined,
  organization: user.organization
    ? { uuid: user.organization.uuid, name: user.organization.name }
    : undefined,
  profile: user.profile ? profileToDto(user.profile) : null,
  documents: Array.isArray(user.documents) ? user.documents.map(documentToDto) : undefined,
  vendor_profile: user.vendorProfile ? vendorProfileToDto(user.vendorProfile) : null,
});

/** Compact DTO for list rows (no heavy nested profile). */
const toListDto = (user) => ({
  id: user.id,
  uuid: user.uuid,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  status: user.status,
  organization_id: user.organization_id,
  manager_id: user.manager_id,
  created_at: user.createdAt,
  role: user.role ? { key: user.role.key, name: user.role.name } : undefined,
  organization: user.organization
    ? { uuid: user.organization.uuid, name: user.organization.name }
    : undefined,
  job_title: user.profile ? user.profile.job_title : null,
  department: user.profile ? user.profile.department : null,
  employee_type: user.profile ? user.profile.employee_type : null,
});

/**
 * POST /users  (requires user.create)
 * org_admin creates a vendor/consultant in their own org; super_admin may target any org.
 * Optionally seeds profile fields; the invited user completes the rest after activation.
 */
const create = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body, req.auth, res);
  res.status(httpStatus.CREATED).send({ message: res.__('userCreated'), data: toDto(user) });
});

/** GET /users  (requires user.read) — tenant + ownership scoped list. */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await userService.listUsers(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toListDto), meta });
});

/** GET /users/vendors  (requires user.read) — vendors in the org, for the C2C dropdown. */
const listVendors = catchAsync(async (req, res) => {
  const data = await userService.listVendors(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data });
});

/** GET /users/:uuid  (requires user.read) — full profile, tenant + ownership scoped. */
const getOne = catchAsync(async (req, res) => {
  const user = await userService.getUserByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('userFound'), data: toDto(user) });
});

/** PATCH /users/:uuid  (requires user.update) — update identity fields. */
const update = catchAsync(async (req, res) => {
  const user = await userService.updateUser(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('userUpdated'), data: toDto(user) });
});

/** PATCH /users/:uuid/profile  (requires user.update) — upsert the profile. */
const updateProfile = catchAsync(async (req, res) => {
  const user = await userService.updateUserProfile(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('userUpdated'), data: toDto(user) });
});

/** GET /users/:uuid/documents  (requires user.read) — merged document checklist. */
const listDocuments = catchAsync(async (req, res) => {
  const docs = await userDocumentService.listUserDocuments(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: docs });
});

/** POST /users/:uuid/documents  (requires user.update) — record an uploaded document. */
const uploadDocument = catchAsync(async (req, res) => {
  const doc = await userDocumentService.uploadUserDocument(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: documentToDto(doc) });
});

/** POST /users/:uuid/resend-invite  (requires user.create) — re-send activation email. */
const resendInvite = catchAsync(async (req, res) => {
  await userService.resendInvite(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('invite_resent'), data: null });
});

module.exports = {
  create,
  list,
  listVendors,
  getOne,
  update,
  updateProfile,
  listDocuments,
  uploadDocument,
  resendInvite,
  // Exported so the auth (self-service) controller can reuse the same DTOs.
  toDto,
  profileToDto,
  documentToDto,
};
