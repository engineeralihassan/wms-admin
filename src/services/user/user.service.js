const httpStatus = require('http-status');
const { User, Role, Organization } = require('../../models');
const ApiError = require('../../utils/ApiError');
const Encrypter = require('../../helper/encrypter');
const { ROLES, ASSIGNABLE_ROLES_BY_ROLE } = require('../../config/rbac');
const { enqueueSafe } = require('../email/email.service');
const { paginate } = require('../../utils/query/paginate');
const { USER_QUERY_CONFIG } = require('../../config/query-configs');

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
  'created_at',
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
 * Create a user. Org comes from the caller's token (super_admin may target an org).
 * Role must be permitted for the caller's role. Vendors stamp manager_id = self.
 */
const createUser = async (body, auth, res) => {
  const { first_name, last_name, email, password, role: roleKey } = body;

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

  const enc = await Encrypter.password_enc(password);
  let user;
  try {
    user = await User.create({
      first_name,
      last_name,
      email,
      password: enc.encr,
      salt: enc.salt,
      organization_id: organizationId,
      role_id: role.id,
      manager_id: setManagerToCaller ? auth.userId : null,
      status: 'active',
    });
  } catch (err) {
    // Authoritative guard against the email-uniqueness race: two concurrent creates
    // both pass the pre-check above, but the DB unique constraint stops the second.
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new ApiError(httpStatus.BAD_REQUEST, res.__('email_already_exist'));
    }
    throw err;
  }

  // Fire-and-forget welcome email; never blocks or fails the API response.
  enqueueSafe('welcome', user.email, {
    firstName: user.first_name,
    organizationName: organization.name,
  });

  return user;
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
    include: [{ model: Role, as: 'role', attributes: ['key', 'name'] }],
  });
};

/** Fetch one user by uuid, still tenant + ownership scoped. */
const getUserByUuid = async (uuid, req, res) => {
  const user = await User.findOne({
    where: { uuid, ...buildUserScope(req) },
    attributes: USER_PUBLIC_ATTRIBUTES,
    include: [{ model: Role, as: 'role', attributes: ['key', 'name'] }],
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('user_not_found'));
  }
  return user;
};

module.exports = {
  createUser,
  listUsers,
  getUserByUuid,
  buildUserScope,
};
