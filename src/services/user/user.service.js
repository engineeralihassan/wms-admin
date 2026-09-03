const httpStatus = require('http-status');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  UserProfile,
  UserDocument,
  VendorProfile,
  Role,
  Organization,
} = require('../../models');
const ApiError = require('../../utils/ApiError');
const { ROLES, ASSIGNABLE_ROLES_BY_ROLE } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { USER_QUERY_CONFIG } = require('../../config/query-configs');
const { buildUnusablePassword, sendActivation } = require('../auth/invitation.service');
const { revokeAllUserTokens } = require('../auth/token.service');
const { tokenTypes } = require('../../config/tokens');
const {
  buildProfileAttributes,
  defaultEmployeeTypeForRole,
  isConsultantRole,
  buildInitialDocumentRows,
} = require('./user-profile.mapper');

/** Columns returned for user list/detail (never password/salt). */
const USER_PUBLIC_ATTRIBUTES = [
  'id',
  'uuid',
  'first_name',
  'last_name',
  'email',
  'status',
  'organization_id',
  'manager_id',
  'createdAt',
];

/** The include chain for a FULL user (profile + documents), used on detail views. */
const fullUserInclude = () => [
  { model: Role, as: 'role', attributes: ['key', 'name'] },
  { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
  { model: UserProfile, as: 'profile' },
  { model: UserDocument, as: 'documents', separate: true, order: [['createdAt', 'ASC']] },
  { model: VendorProfile, as: 'vendorProfile' },
];

/**
 * Builds the "visibility" where-clause for user queries, combining tenant scope
 * with the ownership hierarchy. Single source of truth for which users a caller
 * may see/manage:
 *
 *   super_admin -> {} (all users, all orgs)
 *   org_admin   -> { organization_id: <org> } (everyone in their org)
 *   vendor      -> { organization_id: <org>, manager_id: <self> } (only THEIR consultants)
 *
 * FAIL-CLOSED: this requires the request to have passed through the `tenantScope`
 * middleware (req.tenantScoped === true and req.tenantWhere present). If a future
 * route forgets tenantScope, this THROWS instead of silently returning unscoped data,
 * turning a would-be cross-tenant leak into a loud 500 during development.
 *
 * Org and manager ids come from the signed token (req.auth), never the request body,
 * so a caller can never widen their own visibility.
 */
const buildUserScope = (req) => {
  const { auth, tenantScoped, tenantWhere } = req;
  if (!auth) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Missing authentication context');
  }
  if (tenantScoped !== true || tenantWhere === undefined) {
    // Programmer error: a tenant-scoped query was attempted without tenantScope.
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Tenant scope was not applied for this request'
    );
  }

  // Start from the tenant boundary the middleware computed ({} for super_admin).
  const scope = { ...tenantWhere };
  if (!auth.isSuperAdmin && auth.role === ROLES.VENDOR) {
    // A vendor additionally sees only the users they manage (their consultants).
    scope.manager_id = auth.userId;
  }
  return scope;
};

/**
 * Determine which roles the caller is allowed to assign, and whether the created
 * user should be owned by the caller (manager_id).
 */
const resolveCreationRules = (auth) => {
  if (auth.isSuperAdmin) {
    // Super admin may assign any org-assignable role; not owned by a manager.
    return { allowedRoles: null, setManagerToCaller: false };
  }
  const allowed = ASSIGNABLE_ROLES_BY_ROLE[auth.role] || [];
  // Vendors own the consultants they create.
  const setManagerToCaller = auth.role === ROLES.VENDOR;
  return { allowedRoles: allowed, setManagerToCaller };
};

/**
 * Create a user + their profile (and, for vendors, a vendor company profile) in a
 * single transaction. Org comes from the caller's token (super_admin may target an
 * org). Role must be permitted for the caller's role. Vendors stamp manager_id = self.
 *
 * The account is created 'invited' with an unusable password; an activation email is
 * queued so the user sets their own password (admin never sets it). Profile fields are
 * OPTIONAL — the admin may seed some now; the user completes the rest after login.
 */
const createUser = async (body, auth, res) => {
  const { first_name, last_name, email, role: roleKey } = body;
  const profilePayload = body.profile || {};

  const { allowedRoles, setManagerToCaller } = resolveCreationRules(auth);
  if (allowedRoles && !allowedRoles.includes(roleKey)) {
    throw new ApiError(httpStatus.FORBIDDEN, res.__('role_not_assignable'));
  }

  const organizationId = auth.isSuperAdmin ? body.organization_id : auth.organizationId;
  if (!organizationId) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('organization_required'));
  }

  const organization = await Organization.findByPk(organizationId);
  if (!organization) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('organization_not_found'));
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('email_already_exist'));
  }

  const role = await Role.findOne({ where: { key: roleKey, organization_id: null } });
  if (!role) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, res.__('something_went_wrong'));
  }

  // Resolve the vendor link for a C2C consultant.
  //  - If a VENDOR creates the consultant: they ARE the vendor (owner + vendor_id).
  //  - If an ORG_ADMIN creates a C2C consultant: they may pick a vendor via vendor_uuid.
  // The vendor must be a vendor-role user in the SAME organization (validated below).
  let resolvedVendorId = null;
  if (setManagerToCaller && auth.role === ROLES.VENDOR) {
    resolvedVendorId = auth.userId;
  } else if (roleKey === ROLES.CONSULTANT_C2C && body.vendor_uuid) {
    const vendorRole = await Role.findOne({
      where: { key: ROLES.VENDOR, organization_id: null },
      attributes: ['id'],
    });
    const vendorUser = await User.findOne({
      where: {
        uuid: body.vendor_uuid,
        organization_id: organizationId,
        role_id: vendorRole ? vendorRole.id : -1,
      },
      attributes: ['id'],
    });
    if (!vendorUser) {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('vendor_not_found'));
    }
    resolvedVendorId = vendorUser.id;
  }

  // Invited users get an unusable password until they activate and set their own.
  const enc = await buildUnusablePassword();
  const managerId = setManagerToCaller ? auth.userId : null;

  let user;
  try {
    user = await sequelize.transaction(async (t) => {
      const created = await User.create(
        {
          first_name,
          last_name,
          email,
          password: enc.encr,
          salt: enc.salt,
          organization_id: organizationId,
          role_id: role.id,
          manager_id: managerId,
          status: 'invited',
        },
        { transaction: t }
      );

      // Profile row (1-1). Seed employee_type from the role when not supplied.
      const profileAttrs = buildProfileAttributes(profilePayload);
      if (profileAttrs.employee_type === undefined) {
        const derived = defaultEmployeeTypeForRole(roleKey);
        if (derived) profileAttrs.employee_type = derived;
      }
      await UserProfile.create(
        {
          ...profileAttrs,
          user_id: created.id,
          organization_id: organizationId,
          // Link to the resolved vendor (from the vendor themselves, or an org admin's
          // vendor_uuid selection). null for non-C2C or when no vendor is chosen.
          vendor_id: resolvedVendorId,
        },
        { transaction: t }
      );

      // Seed the empty document checklist for consultants (admin uploads nothing;
      // the consultant provides files after logging in).
      if (isConsultantRole(roleKey)) {
        const docRows = buildInitialDocumentRows(created.id, organizationId);
        await UserDocument.bulkCreate(docRows, { transaction: t });
      }

      // A vendor user gets a company profile shell (details filled later).
      if (roleKey === ROLES.VENDOR) {
        const vendorInput = body.vendor_profile || {};
        await VendorProfile.create(
          {
            user_id: created.id,
            organization_id: organizationId,
            company_name: vendorInput.company_name || `${first_name} ${last_name}`,
            tax_id: vendorInput.tax_id || null,
            contact_person: vendorInput.contact_person || `${first_name} ${last_name}`,
            contact_email: vendorInput.contact_email || email,
            contact_phone: vendorInput.contact_phone || null,
            address: vendorInput.address || {},
            website: vendorInput.website || null,
          },
          { transaction: t }
        );
      }

      return created;
    });
  } catch (err) {
    // Authoritative guard against the email-uniqueness race: two concurrent creates
    // both pass the pre-check above, but the DB unique constraint stops the second.
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('email_already_exist'));
    }
    throw err;
  }

  // Fire-and-forget activation email (queued; never blocks the API response).
  await sendActivation(user, organization.name);

  // Reload with associations so the response carries the full profile.
  return User.findByPk(user.id, {
    attributes: USER_PUBLIC_ATTRIBUTES,
    include: fullUserInclude(),
  });
};

/**
 * List users visible to the caller, with search + sort + pagination.
 * Security scope (tenant + ownership) is computed here and merged by the paginate
 * helper with the parsed search/filter clause, so isolation is always preserved.
 * Returns { data, meta }.
 */
const listUsers = async (req) => {
  return paginate(User, req.query, USER_QUERY_CONFIG, {
    scopeWhere: buildUserScope(req),
    attributes: USER_PUBLIC_ATTRIBUTES,
    include: [
      { model: Role, as: 'role', attributes: ['key', 'name'] },
      { model: Organization, as: 'organization', attributes: ['id', 'uuid', 'name', 'slug'] },
      // Lightweight profile summary for the list (job title / type badge).
      { model: UserProfile, as: 'profile', attributes: ['job_title', 'department', 'employee_type'] },
    ],
  });
};

/**
 * List the vendors in the caller's organization (for the "select vendor" dropdown when
 * creating a C2C consultant). Tenant-scoped: an org_admin sees their org's vendors.
 * Returns a light shape { uuid, name, company_name } — never secrets.
 */
const listVendors = async (req) => {
  const vendorRole = await Role.findOne({
    where: { key: ROLES.VENDOR, organization_id: null },
    attributes: ['id'],
  });
  if (!vendorRole) return [];

  const scope = { ...req.tenantWhere, role_id: vendorRole.id, status: { [Op.ne]: 'disabled' } };
  const vendors = await User.findAll({
    where: scope,
    attributes: ['uuid', 'first_name', 'last_name'],
    include: [{ model: VendorProfile, as: 'vendorProfile', attributes: ['company_name'] }],
    order: [['first_name', 'ASC']],
  });
  return vendors.map((v) => ({
    uuid: v.uuid,
    name: `${v.first_name} ${v.last_name}`,
    company_name: v.vendorProfile ? v.vendorProfile.company_name : null,
  }));
};

/** Fetch one user by uuid with FULL profile + documents, still tenant + ownership scoped. */
const getUserByUuid = async (uuid, req, res) => {
  const user = await User.findOne({
    where: { uuid, ...buildUserScope(req) },
    attributes: USER_PUBLIC_ATTRIBUTES,
    include: fullUserInclude(),
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  return user;
};

/**
 * Load a scoped user row (for mutations). Throws 404 if outside the caller's scope,
 * so an org_admin/vendor can only ever mutate users they're allowed to see.
 */
const findScopedUserOrThrow = async (uuid, req, res, options = {}) => {
  const user = await User.findOne({
    where: { uuid, ...buildUserScope(req) },
    ...options,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  return user;
};

/**
 * Update a user's basic identity fields (name) — email/role/org changes are
 * deliberately excluded here (email is the login + unique key; role changes belong to
 * a dedicated, audited flow). Tenant + ownership scoped.
 */
const updateUser = async (uuid, body, req, res) => {
  const user = await findScopedUserOrThrow(uuid, req, res);
  const patch = {};
  if (body.first_name !== undefined) patch.first_name = body.first_name;
  if (body.last_name !== undefined) patch.last_name = body.last_name;
  if (Object.keys(patch).length) {
    await user.update(patch);
  }
  return getUserByUuid(uuid, req, res);
};

/**
 * Upsert a user's profile (admin editing someone else's profile). Partial: only the
 * keys provided are written; JSONB blocks are replaced wholesale when present.
 * Tenant + ownership scoped via the parent user lookup.
 */
const updateUserProfile = async (uuid, profilePayload, req, res) => {
  const user = await findScopedUserOrThrow(uuid, req, res, {
    include: [{ model: UserProfile, as: 'profile' }],
  });
  const attrs = buildProfileAttributes(profilePayload || {});
  if (user.profile) {
    await user.profile.update(attrs);
  } else {
    await UserProfile.create({
      ...attrs,
      user_id: user.id,
      organization_id: user.organization_id,
    });
  }
  return getUserByUuid(uuid, req, res);
};

/**
 * Resend the activation invite for an 'invited' user (the secure fallback for giving
 * someone access — the admin never sets a password directly). Tenant + ownership
 * scoped, so an org_admin/vendor can only resend for users they can see.
 * Re-issues a fresh invite token (old ones are revoked) and enqueues the email.
 */
const resendInvite = async (uuid, req, res) => {
  const user = await User.findOne({
    where: { uuid, ...buildUserScope(req) },
    include: [{ model: Organization, as: 'organization', attributes: ['name'] }],
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  if (user.status !== 'invited') {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('user_already_active'));
  }
  // Invalidate any previous invite tokens, then issue + email a fresh one.
  await revokeAllUserTokens(user.id, tokenTypes.INVITE);
  await sendActivation(user, user.organization ? user.organization.name : '');
  return true;
};

// ── Self-service (a logged-in user managing their OWN profile) ────────────────

/** Load the caller's own full user + profile + documents (used by /auth/me/profile). */
const getOwnProfile = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: USER_PUBLIC_ATTRIBUTES,
    include: fullUserInclude(),
  });
  return user;
};

/** Upsert the caller's OWN profile. Same partial-write semantics as the admin path. */
const updateOwnProfile = async (userId, profilePayload) => {
  const user = await User.findByPk(userId, {
    include: [{ model: UserProfile, as: 'profile' }],
  });
  const attrs = buildProfileAttributes(profilePayload || {});
  if (user.profile) {
    await user.profile.update(attrs);
  } else {
    await UserProfile.create({
      ...attrs,
      user_id: user.id,
      organization_id: user.organization_id,
    });
  }
  return getOwnProfile(userId);
};

module.exports = {
  createUser,
  listUsers,
  listVendors,
  getUserByUuid,
  updateUser,
  updateUserProfile,
  resendInvite,
  getOwnProfile,
  updateOwnProfile,
  buildUserScope,
};
