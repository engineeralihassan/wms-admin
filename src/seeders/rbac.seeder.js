/**
 * Idempotent RBAC + super admin seeder.
 *
 * Run with:  npm run seed
 *
 * What it does (safe to run repeatedly):
 *  1. Upserts every permission from the RBAC catalog.
 *  2. Upserts the system roles (super_admin, org_admin, vendor, consultant_*).
 *  3. Syncs each system role's permission set from ROLE_PERMISSIONS.
 *  4. Creates the super admin user IF it does not already exist, using
 *     credentials from environment variables (never hardcoded).
 *
 * The super admin is intentionally created ONLY here (a secure, server-side script),
 * never via a public HTTP route.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV || 'DEVELOPMENT'}.env`),
});

const db = require('../models');
const Encrypter = require('../helper/encrypter');
const {
  ROLES,
  ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_SCOPES,
} = require('../config/rbac');

const { Permission, Role, User, sequelize } = db;

async function seedPermissions() {
  const results = {};
  for (const key of ALL_PERMISSIONS) {
    const [permission] = await Permission.findOrCreate({
      where: { key },
      defaults: { key, description: humanize(key) },
    });
    results[key] = permission;
  }
  console.log(`  permissions: ${Object.keys(results).length} ensured`);
  return results;
}

async function seedRoles() {
  const results = {};
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    const [role] = await Role.findOrCreate({
      // System roles are global: organization_id is null.
      where: { key, organization_id: null },
      defaults: {
        key,
        name: def.name,
        scope: def.scope,
        organization_id: null,
        is_system: true,
      },
    });
    results[key] = role;
  }
  console.log(`  roles: ${Object.keys(results).length} ensured`);
  return results;
}

async function syncRolePermissions(roles, permissions) {
  for (const [roleKey, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roles[roleKey];
    if (!role) continue;
    const permInstances = permKeys.map((k) => permissions[k]).filter(Boolean);
    // setPermissions replaces the association set — keeps the seeder idempotent.
    await role.setPermissions(permInstances);
  }
  console.log('  role-permission mappings synced');
}

/**
 * Create trigram indexes for fast case-insensitive substring search (ILIKE '%x%').
 * Plain B-tree indexes can't accelerate leading-wildcard searches; pg_trgm GIN
 * indexes can. Idempotent — safe to run repeatedly.
 */
async function ensureSearchIndexes() {
  const statements = [
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'CREATE INDEX IF NOT EXISTS users_email_trgm ON users USING gin (email gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS users_first_name_trgm ON users USING gin (first_name gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS users_last_name_trgm ON users USING gin (last_name gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS organizations_name_trgm ON organizations USING gin (name gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS organizations_slug_trgm ON organizations USING gin (slug gin_trgm_ops)',
  ];
  for (const sql of statements) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(sql);
  }
  console.log(`  search indexes: ${statements.length - 1} trigram indexes ensured`);
}

async function seedSuperAdmin(roles) {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const firstName = process.env.SUPER_ADMIN_FIRST_NAME || 'Super';
  const lastName = process.env.SUPER_ADMIN_LAST_NAME || 'Admin';

  if (!email || !password) {
    console.warn(
      '  super admin: SKIPPED (set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in your env to create one)'
    );
    return;
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    console.log(`  super admin: already exists (${email})`);
    return;
  }

  const superRole = roles[ROLES.SUPER_ADMIN];
  const enc = await Encrypter.password_enc(password);

  await User.create({
    first_name: firstName,
    last_name: lastName,
    email,
    password: enc.encr,
    salt: enc.salt,
    organization_id: null, // platform-level, not tied to any tenant
    role_id: superRole.id,
    status: 'active',
  });
  console.log(`  super admin: CREATED (${email})`);
}

function humanize(permissionKey) {
  return permissionKey.replace('.', ' ').replace('_', ' ');
}

async function run() {
  console.log(`Seeding RBAC (NODE_ENV=${process.env.NODE_ENV || 'DEVELOPMENT'})...`);
  const transaction = await sequelize.transaction();
  try {
    // Ensure tables exist without dropping data.
    await sequelize.sync();

    const permissions = await seedPermissions();
    const roles = await seedRoles();
    await syncRolePermissions(roles, permissions);
    await seedSuperAdmin(roles);
    await ensureSearchIndexes();

    await transaction.commit();
    console.log('Seeding complete.');
  } catch (err) {
    await transaction.rollback();
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

run();
