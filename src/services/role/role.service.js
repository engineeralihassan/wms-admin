const httpStatus = require('http-status');
const { Role } = require('../../models');
const ApiError = require('../../utils/ApiError');

/**
 * Look up a SYSTEM role by its key (organization_id = null).
 * Throws if the role isn't seeded — a signal that `npm run seed` needs to run.
 */
const getSystemRoleByKey = async (key) => {
  const role = await Role.findOne({ where: { key, organization_id: null } });
  if (!role) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `System role "${key}" is missing. Run the seeder.`
    );
  }
  return role;
};

module.exports = { getSystemRoleByKey };
