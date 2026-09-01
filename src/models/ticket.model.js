const { DataTypes } = require('sequelize');
const { TICKET_PRIORITIES, TICKET_STATUSES } = require('../utils/ticket.constants');

/**
 * Ticket = a tenant-scoped support/work request.
 *
 * Multi-tenancy: every ticket references organization_id. All queries are scoped by
 * organization at the service layer (via the tenantScope middleware + buildTicketScope),
 * so one tenant can never see another tenant's tickets. super_admin (organization_id
 * bypass) is the only actor able to read across organizations.
 *
 * Relationships:
 *   Organization 1───* Ticket           (organization_id)
 *   User(creator) 1───* Ticket          (created_by_id — who submitted it)
 *   User(assignee) 1──* Ticket          (assigned_to_id — who it's assigned to; nullable)
 */
module.exports = (sequelize) => {
  const Ticket = sequelize.define(
    'Ticket',
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

      // Human-friendly identifier (e.g. "TKT-000123"). Unique across the platform.
      ticket_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor: the organization this ticket belongs to.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      // Who submitted the ticket.
      created_by_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Who the ticket is currently assigned to (nullable = unassigned).
      assigned_to_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      subject: {
        type: DataTypes.STRING(500),
        allowNull: false,
        validate: { notEmpty: true, len: [3, 500] },
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true },
      },

      priority: {
        type: DataTypes.ENUM(...Object.values(TICKET_PRIORITIES)),
        allowNull: false,
        defaultValue: TICKET_PRIORITIES.MEDIUM,
      },

      status: {
        type: DataTypes.ENUM(...Object.values(TICKET_STATUSES)),
        allowNull: false,
        defaultValue: TICKET_STATUSES.OPEN,
      },

      // Attachments: for now we store ONLY metadata (the file name), no bytes.
      // JSONB array of { name } objects; open for future fields (key/size/mime/url)
      // when object storage (S3 presigned URLs) is added — no schema change needed.
      attachments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },

      resolved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      closed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'tickets',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['ticket_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['organization_id', 'priority'] },
        { fields: ['organization_id', 'created_by_id'] },
        { fields: ['organization_id', 'assigned_to_id'] },
        // Supports the default list ordering (created_at DESC) within a tenant.
        { fields: ['organization_id', 'created_at'] },
      ],
    }
  );

  return Ticket;
};
