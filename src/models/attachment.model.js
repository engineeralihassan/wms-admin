const { DataTypes } = require('sequelize');

/**
 * Attachment = one uploaded file, stored in object storage, referenced here by link.
 *
 * POLYMORPHIC BY DESIGN (owner_type + owner_id):
 *   Instead of a separate file table per resource, ONE table serves every domain.
 *   A row belongs to whatever "owns" it — an expense, a ticket, a user document,
 *   an organization logo, etc. Adding files to a brand-new resource needs NO schema
 *   change: pick an owner_type string and start writing rows. This is what makes the
 *   upload system future-proof.
 *
 * BYTES LIVE ELSEWHERE:
 *   Postgres only ever holds METADATA + the link. `storage_key` is the opaque
 *   provider key (Cloudinary public_id / S3 key / local path) used to delete or
 *   re-sign the object; `url` is the delivery link handed to the frontend. The
 *   binary itself never touches this database.
 *
 * TENANCY: organization_id is denormalized for fast tenant-scoped listing/auditing
 *   and fail-closed isolation, matching every other domain table.
 */
module.exports = (sequelize) => {
  const Attachment = sequelize.define(
    'Attachment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },

      uuid: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
      },

      // What this file is attached to, e.g. 'expense', 'ticket', 'user_document',
      // 'organization', 'misc'. Free-form string so new owners need no migration.
      owner_type: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },

      // The id of the owning row within owner_type's table. Nullable so files can be
      // uploaded first (generic /files endpoint) and linked to an owner afterwards.
      owner_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      // Multi-tenancy anchor.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      // The multipart field the file arrived on (e.g. 'photos', 'docs'). Lets a
      // single multi-field request keep its files grouped by purpose.
      field_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      // Opaque provider key used to delete / re-sign the object. Kept private.
      storage_key: {
        type: DataTypes.STRING(1024),
        allowNull: false,
      },

      // Which backend stored it ('cloudinary' | 'local' | ...). Useful when the
      // active driver changes but old rows still point at the previous backend.
      storage_driver: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },

      // The delivery link stored in the DB (as requested: "store the link only").
      url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      // Original file metadata (for display / download / validation).
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      file_mime: { type: DataTypes.STRING(120), allowNull: true },
      file_size: { type: DataTypes.INTEGER, allowNull: true },

      // Who performed the upload.
      uploaded_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'attachments',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        // The primary lookup: "give me all files for this owner".
        { fields: ['owner_type', 'owner_id'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'owner_type'] },
        { fields: ['uploaded_by_id'] },
      ],
    }
  );

  return Attachment;
};
