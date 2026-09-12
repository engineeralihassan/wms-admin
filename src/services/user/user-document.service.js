const httpStatus = require('http-status');
const { User, UserProfile, UserDocument } = require('../../models');
const ApiError = require('../../utils/ApiError');
const {
  USER_DOCUMENT_CATALOGUE,
  USER_DOCUMENT_TYPE_KEYS,
  catalogueForEmployeeType,
} = require('../../config/user-documents');
const { visaRequiresExpiry } = require('../../config/profile.constants');
const { buildUserScope } = require('./user.service');

/**
 * User documents live behind two access paths:
 *  - Admin/vendor: manage documents of a user they can SEE (tenant + ownership scoped
 *    through buildUserScope on the parent user).
 *  - Self-service: a logged-in user manages their OWN documents.
 *
 * This service centralises both so the scoping rules can't drift apart. It stores
 * only file METADATA; the binary is expected to live in object storage and be
 * referenced by storage_key (wiring the actual upload transport is a later step).
 */

/** Resolve the parent user id for an admin-managed request (scoped), or throw 404. */
const resolveScopedUser = async (uuid, req, res) => {
  const user = await User.findOne({ where: { uuid, ...buildUserScope(req) } });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  return user;
};

/**
 * Merge the fixed catalogue with the user's stored rows so the FE always renders the
 * full expected checklist, even for slots that have no row yet.
 *
 * @param {Array} rows            the user's UserDocument rows.
 * @param {Object} ctx
 * @param {string|null} ctx.employeeType  filters slots by `appliesTo` (w2/1099/c2c).
 * @param {string|null} ctx.visaStatus    hides `visaOnly` slots for permanent statuses.
 */
const mergeWithCatalogue = (rows, ctx = {}) => {
  const { employeeType = null, visaStatus = null } = ctx;
  const byType = new Map(rows.map((r) => [r.doc_type, r]));
  // Scope the catalogue to this employee type (empty appliesTo = universal).
  const scoped = catalogueForEmployeeType(employeeType).filter((def) => {
    // Work authorization docs only apply to time-bound visa statuses.
    if (def.visaOnly && visaStatus && !visaRequiresExpiry(visaStatus)) return false;
    return true;
  });
  const catalogue = scoped.map((def) => {
    const row = byType.get(def.type);
    return {
      doc_type: def.type,
      label: (row && row.label) || def.label,
      required: def.required,
      sample_url: def.sampleUrl || null,
      status: row ? row.status : 'pending',
      locked: row ? row.status === 'verified' : false,
      uuid: row ? row.uuid : null,
      file_name: row ? row.file_name : null,
      file_mime: row ? row.file_mime : null,
      file_size: row ? row.file_size : null,
      file_url: row ? row.file_url : null,
      expires_on: row ? row.expires_on : null,
      uploaded_at: row ? row.uploaded_at : null,
      note: row ? row.note : null,
    };
  });
  // Include any ad-hoc 'other' documents that aren't in the fixed catalogue.
  const extra = rows
    .filter((r) => !USER_DOCUMENT_CATALOGUE.some((d) => d.type === r.doc_type))
    .map((r) => ({
      doc_type: r.doc_type,
      label: r.label,
      required: false,
      sample_url: null,
      status: r.status,
      locked: r.status === 'verified',
      uuid: r.uuid,
      file_name: r.file_name,
      file_mime: r.file_mime,
      file_size: r.file_size,
      file_url: r.file_url,
      expires_on: r.expires_on,
      uploaded_at: r.uploaded_at,
      note: r.note,
    }));
  return [...catalogue, ...extra];
};

/** Load the profile context (employee_type + visa status) used to scope the catalogue. */
const loadProfileContext = async (userId) => {
  const profile = await UserProfile.findOne({
    where: { user_id: userId },
    attributes: ['employee_type', 'work_permit'],
  });
  return {
    employeeType: profile ? profile.employee_type : null,
    visaStatus: profile && profile.work_permit ? profile.work_permit.visa_status || null : null,
  };
};

/** List a target user's documents (admin/vendor path), scoped. */
const listUserDocuments = async (uuid, req, res) => {
  const user = await resolveScopedUser(uuid, req, res);
  const rows = await UserDocument.findAll({
    where: { user_id: user.id },
    order: [['createdAt', 'ASC']],
  });
  const ctx = await loadProfileContext(user.id);
  return mergeWithCatalogue(rows, ctx);
};

/** List the caller's OWN documents (self-service path). */
const listOwnDocuments = async (userId) => {
  const rows = await UserDocument.findAll({
    where: { user_id: userId },
    order: [['createdAt', 'ASC']],
  });
  const ctx = await loadProfileContext(userId);
  return mergeWithCatalogue(rows, ctx);
};

/**
 * Record an uploaded document (metadata). Upserts by (user_id, doc_type): a known
 * slot is updated in place; an 'other' document creates a new row.
 * `actingUserId` is who performed the upload (self or admin).
 */
const upsertDocument = async ({
  targetUserId,
  organizationId,
  actingUserId,
  payload,
  enforceLock = false,
  res = null,
}) => {
  const {
    doc_type,
    label,
    file_name,
    file_mime,
    file_size,
    storage_key,
    file_url,
    expires_on,
    note,
  } = payload;

  if (!USER_DOCUMENT_TYPE_KEYS.includes(doc_type)) {
    // Validation should have caught this; guard anyway.
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid document type');
  }

  const [row] = await UserDocument.findOrCreate({
    where: { user_id: targetUserId, doc_type },
    defaults: {
      user_id: targetUserId,
      organization_id: organizationId,
      doc_type,
      label: label || null,
    },
  });

  // LOCK RULE: a verified document is locked. Self-service (enforceLock) callers may
  // not replace it — they must request a change via a ticket so an admin unlocks it.
  if (enforceLock && row.status === 'verified') {
    const msg = res ? res.__('document_locked') : 'This document is locked and cannot be changed.';
    throw new ApiError(httpStatus.CONFLICT, msg);
  }

  await row.update({
    label: label || row.label,
    status: 'uploaded',
    file_name: file_name || row.file_name,
    file_mime: file_mime || row.file_mime,
    file_size: file_size != null ? file_size : row.file_size,
    storage_key: storage_key || row.storage_key,
    file_url: file_url || row.file_url,
    expires_on: expires_on || row.expires_on,
    note: note !== undefined ? note : row.note,
    uploaded_by_id: actingUserId,
    uploaded_at: new Date(),
  });

  return row;
};

/** Admin/vendor records an upload for a scoped target user. */
const uploadUserDocument = async (uuid, payload, req, res) => {
  const user = await resolveScopedUser(uuid, req, res);
  return upsertDocument({
    targetUserId: user.id,
    organizationId: user.organization_id,
    actingUserId: req.auth.userId,
    payload,
  });
};

/** Caller records an upload for their OWN document. Locked (verified) slots are rejected. */
const uploadOwnDocument = async (userId, organizationId, payload, res = null) => {
  return upsertDocument({
    targetUserId: userId,
    organizationId,
    actingUserId: userId,
    payload,
    enforceLock: true,
    res,
  });
};

/**
 * Admin approves/rejects a document (locks/unlocks it). Tenant + ownership scoped
 * through the parent user. 'verified' => locked; anything else unlocks it and lets the
 * user re-upload. Requires user.update (enforced at the route).
 */
const setDocumentStatus = async (uuid, docUuid, { status, note }, req, res) => {
  const user = await resolveScopedUser(uuid, req, res);
  const row = await UserDocument.findOne({ where: { uuid: docUuid, user_id: user.id } });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('document_not_found'));
  }
  await row.update({
    status,
    note: note !== undefined ? note : row.note,
  });
  return row;
};

module.exports = {
  listUserDocuments,
  listOwnDocuments,
  uploadUserDocument,
  uploadOwnDocument,
  setDocumentStatus,
  mergeWithCatalogue,
};
