const User = require('./user.model');
const Token = require('./token.model');
const Organization = require('./organization.model');
const Role = require('./role.model');
const Permission = require('./permission.model');
const RolePermission = require('./role-permission.model');
const EmailJob = require('./email-job.model');
const Ticket = require('./ticket.model');

/**
 * Registers all models and their associations on the shared sequelize instance.
 *
 * Relationship graph:
 *   Organization 1───* User          (a user belongs to one org; super_admin has none)
 *   Role         1───* User          (a user has one role)
 *   Organization 1───* Role          (custom org roles; system roles have org = null)
 *   Role         *───* Permission    (via role_permissions)
 *   User         1───* Token         (refresh tokens etc.)
 *   User         1───* User          (manager owns managed users; vendor -> consultants)
 *   Organization 1───* Ticket        (tenant-scoped tickets)
 *   User         1───* Ticket        (creator: created_by_id)
 *   User         1───* Ticket        (assignee: assigned_to_id, nullable)
 */
const definitions = (sequelize, Sequelize) => {
  const db = {};
  db.Sequelize = Sequelize;
  db.sequelize = sequelize;

  db.User = User(sequelize);
  db.Token = Token(sequelize);
  db.Organization = Organization(sequelize);
  db.Role = Role(sequelize);
  db.Permission = Permission(sequelize);
  db.RolePermission = RolePermission(sequelize);
  db.EmailJob = EmailJob(sequelize);
  db.Ticket = Ticket(sequelize);

  // Organization <-> User
  db.Organization.hasMany(db.User, { foreignKey: 'organization_id', as: 'users' });
  db.User.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // Role <-> User
  db.Role.hasMany(db.User, { foreignKey: 'role_id', as: 'users' });
  db.User.belongsTo(db.Role, { foreignKey: 'role_id', as: 'role' });

  // Organization <-> Role (custom roles per org)
  db.Organization.hasMany(db.Role, { foreignKey: 'organization_id', as: 'roles' });
  db.Role.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // Role <-> Permission (many-to-many through role_permissions)
  db.Role.belongsToMany(db.Permission, {
    through: db.RolePermission,
    foreignKey: 'role_id',
    otherKey: 'permission_id',
    as: 'permissions',
  });
  db.Permission.belongsToMany(db.Role, {
    through: db.RolePermission,
    foreignKey: 'permission_id',
    otherKey: 'role_id',
    as: 'roles',
  });

  // User <-> Token
  db.User.hasMany(db.Token, { foreignKey: 'user_id', as: 'tokens' });
  db.Token.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });

  // User <-> User (ownership hierarchy: a manager owns many managed users)
  db.User.hasMany(db.User, { foreignKey: 'manager_id', as: 'managedUsers' });
  db.User.belongsTo(db.User, { foreignKey: 'manager_id', as: 'manager' });

  // Organization <-> Ticket (tenant scope)
  db.Organization.hasMany(db.Ticket, { foreignKey: 'organization_id', as: 'tickets' });
  db.Ticket.belongsTo(db.Organization, { foreignKey: 'organization_id', as: 'organization' });

  // User <-> Ticket (creator + assignee, two distinct associations)
  db.User.hasMany(db.Ticket, { foreignKey: 'created_by_id', as: 'createdTickets' });
  db.Ticket.belongsTo(db.User, { foreignKey: 'created_by_id', as: 'creator' });
  db.User.hasMany(db.Ticket, { foreignKey: 'assigned_to_id', as: 'assignedTickets' });
  db.Ticket.belongsTo(db.User, { foreignKey: 'assigned_to_id', as: 'assignee' });

  return db;
};

module.exports = definitions;
