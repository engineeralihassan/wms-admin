const httpStatus = require('http-status');
const { Op } = require('sequelize');
const { sequelize, Organization, User } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { getSystemRoleByKey } = require('../role/role.service');
const { ROLES } = require('../../config/rbac');
const { paginate } = require('../../utils/query/paginate');
const { ORGANIZATION_QUERY_CONFIG } = require('../../config/query-configs');
const { buildUnusablePassword, sendActivation } = require('../auth/invitation.service');
const { revokeAllUserTokens } = require('../auth/token.service');
const { tokenTypes } = require('../../config/tokens');
const fileService = require('../storage/file.service');

/** Turn a name into a URL-safe slug (letters, numbers, hyphens). */
const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Create an organization AND its first org_admin in a single transaction.
 * Either both succeed or neither does — no orphan orgs, no admin-less tenants.
 *
 * The org_admin is created as 'invited' with no usable password; they receive an
 * activation email to set their own password (the super admin never sets it).
 *
 * @param {object} body { name, admin: { first_name, last_name, email }, logo? }
 *   logo is optional: { url, storageKey } produced by the storage layer.
 */
const createOrganizationWithAdmin = async (body, res) => {
  const { name, admin, logo } = body;

  const baseSlug = slugify(name);
  const slug = await uniqueSlug(baseSlug);

  // Reject duplicate admin email up front (clearer error than a constraint failure).
  const existing = await User.findOne({ where: { email: admin.email } });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('email_already_exist'));
  }

  const orgAdminRole = await getSystemRoleByKey(ROLES.ORG_ADMIN);
  const enc = await buildUnusablePassword();

  const result = await sequelize.transaction(async (transaction) => {
    const organization = await Organization.create(
      {
        name,
        slug,
        is_active: true,
        logo_url: logo?.url || null,
        logo_storage_key: logo?.storageKey || null,
      },
      { transaction }
    );

    const adminUser = await User.create(
      {
        first_name: admin.first_name,
        last_name: admin.last_name,
        email: admin.email,
        password: enc.encr,
        salt: enc.salt,
        organization_id: organization.id,
        role_id: orgAdminRole.id,
        status: 'invited',
      },
      { transaction }
    );

    // Seed this tenant's default leave types (annual/sick/casual/unpaid). Required
    // lazily to avoid a circular dependency through the services barrel.
    // eslint-disable-next-line global-require
    const { ensureDefaultLeaveTypes } = require('../leaves/leave.service');
    await ensureDefaultLeaveTypes(organization.id, adminUser.id, transaction);

    return { organization, adminUser };
  });

  // Only email AFTER the transaction commits (never for a rolled-back org).
  await sendActivation(result.adminUser, result.organization.name);

  return result;
};

/**
 * List organizations (super_admin only) with search + sort + pagination.
 * No tenant scope (super_admin sees all); returns { data, meta }.
 */
const listOrganizations = async (rawQuery) => {
  const result = await paginate(Organization, rawQuery, ORGANIZATION_QUERY_CONFIG, {
    attributes: ['id', 'uuid', 'name', 'slug', 'is_active', 'logo_url', 'createdAt'],
  });

  // Annotate each org with whether its admin has activated their account yet, so the
  // UI can offer "Resend activation" only where it makes sense. Done as ONE batched
  // query over just this page's orgs (no N+1, no pagination-count distortion).
  const orgIds = result.data.map((o) => o.id);
  if (orgIds.length > 0) {
    const orgAdminRole = await getSystemRoleByKey(ROLES.ORG_ADMIN);
    const pendingAdmins = await User.findAll({
      where: {
        organization_id: { [Op.in]: orgIds },
        role_id: orgAdminRole.id,
        status: 'invited',
      },
      attributes: ['organization_id'],
      raw: true,
    });
    const pendingOrgIds = new Set(pendingAdmins.map((u) => u.organization_id));
    result.data = result.data.map((o) => {
      // Sequelize instances: expose the flag via get() so the controller can read it.
      o.setDataValue('admin_activated', !pendingOrgIds.has(o.id));
      return o;
    });
  }

  return result;
};

/**
 * Update an organization's editable fields (super_admin only).
 *
 * Editable: `name` and the brand `logo`. Deliberately NOT editable:
 *  - `slug`  — the tenant's stable unique identifier; changing it would break links
 *              and tenant identity, so it is locked (kept as-is, never re-derived).
 *  - `uuid` / `id` / `is_active` — identity + activation are managed elsewhere
 *              (status has its own endpoint), so they are ignored here.
 *
 * @param {string} uuid
 * @param {object} changes  { name?, logo?, removeLogo? }
 *   logo: { url, storageKey } from the storage layer when a new file was uploaded.
 *   removeLogo: true to clear an existing logo (ignored when a new logo is provided).
 */
const updateOrganization = async (uuid, changes, res) => {
  const organization = await Organization.findOne({ where: { uuid } });
  if (!organization) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('organization_not_found'));
  }

  const { name, logo, removeLogo } = changes;

  // Nothing to change? Reject clearly rather than issuing a no-op UPDATE.
  if (name === undefined && !logo && !removeLogo) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('no_changes_provided'));
  }

  const previousLogoKey = organization.logo_storage_key;

  if (name !== undefined) {
    organization.name = name;
  }

  if (logo) {
    // Replacing the logo: point at the new object.
    organization.logo_url = logo.url;
    organization.logo_storage_key = logo.storageKey;
  } else if (removeLogo) {
    organization.logo_url = null;
    organization.logo_storage_key = null;
  }

  await organization.save();

  // After a successful save, best-effort remove the OLD object so we don't orphan it
  // in storage. Only when it actually changed (replaced or removed).
  const logoChanged = Boolean(logo) || removeLogo;
  if (logoChanged && previousLogoKey && previousLogoKey !== organization.logo_storage_key) {
    await fileService.removeMany([previousLogoKey]);
  }

  return organization;
};

/**
 * Resend the activation (invite) email to an organization's admin who has not yet
 * activated their account. Super_admin only (route-enforced). Mirrors the user
 * resend-invite flow: revoke stale invite tokens, then issue + email a fresh one.
 *
 * We target the org's org_admin. If that admin is already active, this is a no-op
 * error (nothing to resend).
 */
const resendOrgActivation = async (uuid, res) => {
  const organization = await Organization.findOne({ where: { uuid } });
  if (!organization) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('organization_not_found'));
  }

  const orgAdminRole = await getSystemRoleByKey(ROLES.ORG_ADMIN);
  // The org's admin — prefer one who's still invited (the whole point of resending).
  const admin = await User.findOne({
    where: { organization_id: organization.id, role_id: orgAdminRole.id },
    order: [['created_at', 'ASC']],
  });

  if (!admin) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('org_admin_not_found'));
  }
  if (admin.status !== 'invited') {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('user_already_active'));
  }

  await revokeAllUserTokens(admin.id, tokenTypes.INVITE);
  await sendActivation(admin, organization.name);
  return true;
};

/** Enable or disable a tenant. Route authorization limits this to super admins. */
const updateOrganizationStatus = async (uuid, isActive, res) => {
  const organization = await Organization.findOne({ where: { uuid } });
  if (!organization) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('organization_not_found'));
  }
  organization.is_active = isActive;
  await organization.save();
  return organization;
};

/**
 * Ensure the slug is unique by appending a counter if needed.
 * Fetches all existing slugs that share the base prefix in ONE query (no N+1 loop),
 * then finds the first free suffix in memory.
 */
const uniqueSlug = async (base) => {
  const root = base || 'org';
  const existing = await Organization.findAll({
    where: { slug: { [Op.like]: `${root}%` } },
    attributes: ['slug'],
    raw: true,
  });
  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
};

module.exports = {
  createOrganizationWithAdmin,
  listOrganizations,
  updateOrganization,
  resendOrgActivation,
  updateOrganizationStatus,
};
