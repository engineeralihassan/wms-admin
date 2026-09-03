const Joi = require('joi');
const { ORG_ASSIGNABLE_ROLES } = require('../../config/rbac');
const { USER_DOCUMENT_TYPE_KEYS } = require('../../config/user-documents');
const { listQuery } = require('../common.validation');

// ── Reusable nested sub-schemas (shared by create + update) ───────────────────

const addressSchema = Joi.object().keys({
  line1: Joi.string().allow('').max(200),
  line2: Joi.string().allow('').max(200),
  city: Joi.string().allow('').max(120),
  state: Joi.string().allow('').max(120),
  zip: Joi.string().allow('').max(30),
  country: Joi.string().allow('').max(120),
});

const workInformationSchema = Joi.object().keys({
  job_title: Joi.string().allow('').max(150),
  job_position: Joi.string().allow('').max(150),
  department: Joi.string().allow('').max(150),
  work_email: Joi.string().allow('').email(),
  work_phone: Joi.string().allow('').max(40),
  work_mobile: Joi.string().allow('').max(40),
  work_location: Joi.string().allow('').max(150),
  working_hours: Joi.string().allow('').max(120),
  work_address: addressSchema,
});

const privateInformationSchema = Joi.object().keys({
  private_address: addressSchema,
  private_email: Joi.string().allow('').email(),
  private_phone: Joi.string().allow('').max(40),
  identification_no: Joi.string().allow('').max(80),
  passport_no: Joi.string().allow('').max(80),
  citizenship: Joi.object().keys({
    country_of_residence: Joi.string().allow('').max(120),
    ssn_no: Joi.string().allow('').max(40),
    gender: Joi.string().allow('').valid('male', 'female', 'other', 'prefer_not_to_say', ''),
    date_of_birth: Joi.date().iso(),
    place_of_birth: Joi.string().allow('').max(120),
    country_of_birth: Joi.string().allow('').max(120),
  }),
  emergency_contact: Joi.object().keys({
    contact_name: Joi.string().allow('').max(150),
    contact_phone: Joi.string().allow('').max(40),
    contact_email: Joi.string().allow('').email(),
    relation: Joi.string().allow('').max(80),
  }),
  education: Joi.object().keys({
    certificate_level: Joi.string().allow('').max(120),
    field_of_study: Joi.string().allow('').max(150),
    school: Joi.string().allow('').max(200),
  }),
  work_permit: Joi.object().keys({
    visa_no: Joi.string().allow('').max(80),
    visa_type: Joi.string().allow('').max(80),
    work_permit_no: Joi.string().allow('').max(80),
    visa_expiration_date: Joi.date().iso(),
    work_permit_expiration_date: Joi.date().iso(),
  }),
});

const contractSchema = Joi.object().keys({
  contract_reference: Joi.string().allow('').max(150),
  contract_start_date: Joi.date().iso(),
  contract_end_date: Joi.date().iso(),
  notice_period_days: Joi.number().integer().min(0).max(3650),
  working_schedule: Joi.string().allow('').max(120),
  contract_type: Joi.string().allow('').max(80),
  wage: Joi.number().min(0),
  wage_currency: Joi.string().length(3).uppercase(),
  monthly_advantages: Joi.object().keys({
    hra: Joi.number().min(0),
    da: Joi.number().min(0),
    travel_allowance: Joi.number().min(0),
    meal_allowance: Joi.number().min(0),
    medical_allowance: Joi.number().min(0),
    other_allowance: Joi.number().min(0),
  }),
});

const settingsSchema = Joi.object().keys({
  employee_type: Joi.string().allow('').valid('w2', '1099', 'c2c', 'employee', 'vendor', ''),
  joining_date: Joi.date().iso(),
});

// The full nested profile payload (all tabs optional; filled progressively).
const profileSchema = Joi.object().keys({
  work_information: workInformationSchema,
  private_information: privateInformationSchema,
  contract: contractSchema,
  settings: settingsSchema,
});

const vendorProfileSchema = Joi.object().keys({
  company_name: Joi.string().max(200),
  tax_id: Joi.string().allow('').max(80),
  contact_person: Joi.string().allow('').max(150),
  contact_email: Joi.string().allow('').email(),
  contact_phone: Joi.string().allow('').max(40),
  address: addressSchema,
  website: Joi.string().allow('').max(200),
});

// ── Route schemas ─────────────────────────────────────────────────────────────

// Identity + role are required; profile/vendor_profile are optional and can be
// completed later. No password: created users are 'invited' and set their own.
const createUser = {
  body: Joi.object().keys({
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    email: Joi.string().required().email(),
    role: Joi.string()
      .required()
      .valid(...ORG_ASSIGNABLE_ROLES),
    // Only used by super_admin to target a specific org; ignored for org_admin.
    organization_id: Joi.number().integer().optional(),
    // For a C2C consultant: the vendor (company) they work through, chosen from the
    // org's vendors. Ignored for other roles.
    vendor_uuid: Joi.string().uuid().optional(),
    profile: profileSchema.optional(),
    // Company details when creating a vendor user.
    vendor_profile: vendorProfileSchema.optional(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    uuid: Joi.string().required().uuid(),
  }),
};

const listUsers = {
  query: Joi.object().keys(listQuery),
};

const updateUser = {
  params: Joi.object().keys({ uuid: Joi.string().required().uuid() }),
  body: Joi.object()
    .keys({
      first_name: Joi.string(),
      last_name: Joi.string(),
    })
    .min(1),
};

const updateUserProfile = {
  params: Joi.object().keys({ uuid: Joi.string().required().uuid() }),
  body: profileSchema.min(1),
};

const documentUpload = {
  params: Joi.object().keys({ uuid: Joi.string().required().uuid() }),
  body: Joi.object().keys({
    doc_type: Joi.string()
      .required()
      .valid(...USER_DOCUMENT_TYPE_KEYS),
    label: Joi.string().allow('').max(150),
    file_name: Joi.string().max(255),
    file_mime: Joi.string().max(120),
    file_size: Joi.number().integer().min(0),
    storage_key: Joi.string().max(512),
    expires_on: Joi.date().iso(),
    note: Joi.string().allow('').max(500),
  }),
};

// ── Self-service (/auth/me) schemas ──────────────────────────────────────────

const updateOwnProfile = {
  body: profileSchema.min(1),
};

const uploadOwnDocument = {
  body: Joi.object().keys({
    doc_type: Joi.string()
      .required()
      .valid(...USER_DOCUMENT_TYPE_KEYS),
    label: Joi.string().allow('').max(150),
    file_name: Joi.string().max(255),
    file_mime: Joi.string().max(120),
    file_size: Joi.number().integer().min(0),
    storage_key: Joi.string().max(512),
    expires_on: Joi.date().iso(),
    note: Joi.string().allow('').max(500),
  }),
};

module.exports = {
  createUser,
  getUser,
  listUsers,
  updateUser,
  updateUserProfile,
  documentUpload,
  updateOwnProfile,
  uploadOwnDocument,
};
