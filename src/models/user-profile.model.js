const { DataTypes } = require('sequelize');

/**
 * UserProfile = the rich, Odoo-style employee/consultant profile that hangs off a
 * User in a 1-to-1 relationship.
 *
 * WHY A SEPARATE TABLE (not columns on `users`):
 *  - `users` is on the hot auth path (loaded on every authenticated request via
 *    authVerify). Keeping it lean — identity + auth + tenancy only — keeps that
 *    query fast. All the "fill-in-later" profile data lives here and is loaded only
 *    when a profile is actually viewed/edited.
 *  - Profiles are filled progressively: the org admin seeds some fields at creation,
 *    the consultant completes the rest after activating their account. A dedicated
 *    table makes every field nullable/optional without polluting the auth model.
 *
 * FIELD GROUPING:
 *  - Frequently displayed/searched scalars (job_title, department, employee_type,
 *    joining_date) are real columns.
 *  - Cohesive but rarely-queried groups (address, citizenship, emergency contact,
 *    education, work permit, contract advantages) are JSONB blocks. JSONB keeps the
 *    schema stable as the UI evolves and avoids a wide, sparse table. None of these
 *    groups need to be filtered/sorted at the DB level, so JSONB is the right tradeoff.
 *
 * TENANCY: organization_id is denormalized here (copied from the owning user) so
 * profile-only queries and future reporting stay tenant-scoped without a join.
 */
module.exports = (sequelize) => {
  const UserProfile = sequelize.define(
    'UserProfile',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        autoIncrement: true,
      },
      // 1-to-1 owner. Unique so a user can never have two profiles.
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
      },
      // Denormalized tenant key (mirrors users.organization_id) for fast scoped reads.
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },

      // ── Work Information ────────────────────────────────────────────────────
      job_title: { type: DataTypes.STRING(150), allowNull: true },
      job_position: { type: DataTypes.STRING(150), allowNull: true },
      department: { type: DataTypes.STRING(150), allowNull: true },
      work_email: { type: DataTypes.STRING(128), allowNull: true },
      work_phone: { type: DataTypes.STRING(40), allowNull: true },
      work_mobile: { type: DataTypes.STRING(40), allowNull: true },
      work_location: { type: DataTypes.STRING(150), allowNull: true },
      // { line1, line2, city, state, zip, country }
      work_address: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // e.g. "Standard 40 hours/week"
      working_hours: { type: DataTypes.STRING(120), allowNull: true },

      // ── Private Information ─────────────────────────────────────────────────
      // { line1, line2, city, state, zip, country }
      private_address: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      private_email: { type: DataTypes.STRING(128), allowNull: true },
      private_phone: { type: DataTypes.STRING(40), allowNull: true },
      // Government / internal identification number.
      identification_no: { type: DataTypes.STRING(80), allowNull: true },
      passport_no: { type: DataTypes.STRING(80), allowNull: true },
      // { country_of_residence, ssn_no, gender, date_of_birth, place_of_birth, country_of_birth }
      citizenship: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // { contact_name, contact_phone, contact_email, relation }
      emergency_contact: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // { certificate_level, field_of_study, school }
      education: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // { visa_status, visa_no, visa_type, work_permit_no, visa_expiration_date,
      //   work_permit_expiration_date }. `visa_status` is a canonical key from
      // config/profile.constants VISA_STATUSES and drives the conditional UI
      // (e.g. permanent statuses hide the expiration date).
      work_permit: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

      // ── Bank details ────────────────────────────────────────────────────────
      // Cohesive but rarely-queried, and sensitive. Stored as a JSONB block (same
      // pattern as the other groups). Account/routing numbers are stored raw but
      // MASKED in the self-service DTO (only last 4 returned to the browser).
      // { bank_name, account_holder_name, account_type, routing_number,
      //   account_number, cheque_document_id }
      bank_details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

      // ── Contract ────────────────────────────────────────────────────────────
      contract_reference: { type: DataTypes.STRING(150), allowNull: true },
      contract_start_date: { type: DataTypes.DATEONLY, allowNull: true },
      contract_end_date: { type: DataTypes.DATEONLY, allowNull: true },
      notice_period_days: { type: DataTypes.INTEGER, allowNull: true },
      working_schedule: { type: DataTypes.STRING(120), allowNull: true },
      contract_type: { type: DataTypes.STRING(80), allowNull: true },
      // Monthly wage. NUMERIC(12,2) avoids floating-point money errors.
      wage: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      wage_currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
      // { hra, da, travel_allowance, meal_allowance, medical_allowance, other_allowance }
      monthly_advantages: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

      // ── Settings ────────────────────────────────────────────────────────────
      // The consultant classification. Mirrors the user's role but stored here too so
      // the profile is self-describing (e.g. 'w2', '1099', 'c2c', 'employee').
      employee_type: { type: DataTypes.STRING(40), allowNull: true },
      joining_date: { type: DataTypes.DATEONLY, allowNull: true },

      // ── Vendor linkage (C2C) ────────────────────────────────────────────────
      // For a C2C consultant, the vendor (company) they work through. Points at the
      // vendor USER that owns them. Nullable; set when a vendor-managed consultant
      // is created. Vendor-ready without requiring the vendor portal yet.
      vendor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      // Completion tracking so the UI can nudge the consultant to finish their profile.
      profile_completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // ── Section locking (Option A) ──────────────────────────────────────────
      // JSONB map of { <section_key>: { status, verified_by_id, verified_at, note } }
      // for the structured, lockable sections (bank_details, work_authorization,
      // emergency_contact). A section with status 'verified' is LOCKED: self-service
      // writes to it are rejected server-side until an admin unlocks it. Documents
      // lock independently via UserDocument.status. Keys come from
      // config/profile.constants PROFILE_SECTIONS.
      verified_sections: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      tableName: 'user_profiles',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['user_id'] },
        { fields: ['organization_id'] },
        { fields: ['vendor_id'] },
        { fields: ['employee_type'] },
      ],
    }
  );

  return UserProfile;
};
