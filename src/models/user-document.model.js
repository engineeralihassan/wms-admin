const { DataTypes } = require('sequelize');

/**
 * UserDocument = a single document belonging to a user's profile (offer letter,
 * ID proof, work authorization, etc.).
 *
 * DESIGN:
 *  - A user has MANY documents (1-to-many). Each row is one uploaded/expected file.
 *  - `doc_type` is a slot key from a known catalogue so the FE can render a fixed set
 *    of expected documents ("here are the documents you need to provide") even before
 *    anything is uploaded. Free-form `label` supports ad-hoc extra documents.
 *  - The admin side leaves these EMPTY for now; the consultant uploads them after
 *    logging in. So most rows start as status 'pending' (expected, not yet provided).
 *  - We store file METADATA here (name, mime, size, storage_key/url). The actual
 *    binary lives in object storage (S3/local); this table never holds the bytes.
 *
 * TENANCY: organization_id is denormalized for fast tenant-scoped listing/auditing.
 */
module.exports = (sequelize) => {
  const UserDocument = sequelize.define(
    'UserDocument',
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
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },
      // Slot key from the document catalogue (see config/user-documents.js).
      // e.g. 'offer_letter', 'id_proof', 'work_authorization', 'resume', 'other'.
      doc_type: { type: DataTypes.STRING(60), allowNull: false },
      // Human-friendly label (defaults from the catalogue; editable for 'other').
      label: { type: DataTypes.STRING(150), allowNull: true },
      // Lifecycle of the document slot.
      status: {
        type: DataTypes.ENUM,
        values: ['pending', 'uploaded', 'verified', 'rejected'],
        allowNull: false,
        defaultValue: 'pending',
      },
      // File metadata (null until uploaded). The binary lives in object storage.
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      file_mime: { type: DataTypes.STRING(120), allowNull: true },
      file_size: { type: DataTypes.INTEGER, allowNull: true },
      // Opaque storage key/path (e.g. S3 object key). Kept private; a signed URL is
      // generated on demand rather than storing a public URL.
      storage_key: { type: DataTypes.STRING(512), allowNull: true },
      // Optional expiry (e.g. a visa/work-permit document that must be renewed).
      expires_on: { type: DataTypes.DATEONLY, allowNull: true },
      // Who uploaded it (usually the user themselves, sometimes an admin).
      uploaded_by_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      uploaded_at: { type: DataTypes.DATE, allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: 'user_documents',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['organization_id'] },
        { fields: ['status'] },
        // A user has at most one row per document slot type.
        { unique: true, fields: ['user_id', 'doc_type'] },
      ],
    }
  );

  return UserDocument;
};
