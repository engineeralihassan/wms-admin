const { DataTypes } = require('sequelize');

/**
 * SalesTeam = a named group of sales users within an organization.
 *
 * Deliberately NOT a new "salesperson" entity: a team's members are existing platform
 * Users, joined through sales_team_members (the same project/project_members pattern).
 * A team optionally names a lead user. Teams are the unit for future team-based targets,
 * territories and "my team's records" visibility.
 *
 * Relationships:
 *   Organization 1───* SalesTeam          (organization_id)
 *   User(lead)   0..1─ SalesTeam          (lead_user_id, nullable)
 *   SalesTeam    *───* User               (members, through sales_team_members)
 */
module.exports = (sequelize) => {
  const SalesTeam = sequelize.define(
    'SalesTeam',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },

      uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        unique: true,
      },

      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      lead_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true, len: [1, 150] },
      },
    },
    {
      tableName: 'sales_teams',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
      ],
    }
  );

  return SalesTeam;
};
