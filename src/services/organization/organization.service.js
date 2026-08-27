const httpStatus = require('http-status');
const { Op } = require('sequelize');
const { sequelize, Organization, User } = require('../../models');
const ApiError = require('../../utils/ApiError');
const Encrypter = require('../../helper/encrypter');
const { getSystemRoleByKey } = require('../role/role.service');
const { ROLES } = require('../../config/rbac');
const { enqueueSafe } = require('../email/email.service');
const { paginate } = require('../../utils/query/paginate');
const { ORGANIZATION_QUERY_CONFIG } = require('../../config/query-configs');

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
 * @param {object} body { name, admin: { first_name, last_name, email, password } }
 */
const createOrganizationWithAdmin = async (body, res) => {
  const { name, admin } = body;

  const baseSlug = slugify(name);
  const slug = await uniqueSlug(baseSlug);

  // Reject duplicate admin email up front (clearer error than a constraint failure).
  const existing = await User.findOne({ where: { email: admin.email } });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, res.__('email_already_exist'));
  }

  const orgAdminRole = await getSystemRoleByKey(ROLES.ORG_ADMIN);
  const enc = await Encrypter.password_enc(admin.password);

  const result = await sequelize.transaction(async (transaction) => {
    const organization = await Organization.create(
      { name, slug, is_active: true },
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
        status: 'active',
      },
      { transaction }
    );

    return { organization, adminUser };
  });

  // Only email AFTER the transaction commits (never for a rolled-back org).
  enqueueSafe('organization_welcome', result.adminUser.email, {
    firstName: result.adminUser.first_name,
    organizationName: result.organization.name,
  });

  return result;
};

/**
 * List organizations (super_admin only) with search + sort + pagination.
 * No tenant scope (super_admin sees all); returns { data, meta }.
 */
const listOrganizations = async (rawQuery) => {
  return paginate(Organization, rawQuery, ORGANIZATION_QUERY_CONFIG, {
    attributes: ['id', 'uuid', 'name', 'slug', 'is_active', 'created_at'],
  });
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
};
