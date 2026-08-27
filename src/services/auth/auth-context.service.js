const { User, Role, Permission } = require('../../models');
const { ROLES } = require('../../config/rbac');

/**
 * Resolves the full authorization context for a user: their role key,
 * organization, and the flat list of permission keys granted by their role.
 *
 * This is the single place that turns "a user row" into "what they can do",
 * used by login and token refresh so the JWT claims are always consistent.
 *
 * super_admin gets an implicit '*' marker in addition to explicit permissions,
 * so the authorization layer can grant unconditional access without enumerating.
 */
const buildAuthContext = async (userId) => {
  const user = await User.findByPk(userId, {
    include: [
      {
        model: Role,
        as: 'role',
        include: [{ model: Permission, as: 'permissions', attributes: ['key'], through: { attributes: [] } }],
      },
    ],
  });

  if (!user || !user.role) {
    return null;
  }

  const roleKey = user.role.key;
  const permissions = (user.role.permissions || []).map((p) => p.key);

  return {
    userId: user.id,
    uuid: user.uuid,
    organizationId: user.organization_id, // null for super_admin
    role: roleKey,
    isSuperAdmin: roleKey === ROLES.SUPER_ADMIN,
    permissions,
    tokenVersion: user.token_version,
    status: user.status,
  };
};

module.exports = { buildAuthContext };
