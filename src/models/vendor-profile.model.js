const { DataTypes } = require('sequelize');

/**
 * VendorProfile = company details for a VENDOR user.
 *
 * CONTEXT (what a "vendor" is here): in a staffing / C2C (corp-to-corp) model, a
 * vendor is a subcontracting company that supplies consultants. The prime org
 * contracts with the vendor company; the vendor pays its own consultants. A vendor
 * USER (role = 'vendor') logs in and — in a later phase — manages the consultants
 * they supply (the ownership hierarchy via users.manager_id already supports this).
 *
 * This table holds the vendor's COMPANY information (1-to-1 with the vendor user).
 * It's intentionally minimal for now but shaped so the vendor self-service portal can
 * be built later without a migration rewrite.
 *
 * TENANCY: a vendor still belongs to exactly one organization (the prime org that
 * onboarded them); organization_id is denormalized here for scoped queries.
 */
module.exports = (sequelize) => {
  const VendorProfile = sequelize.define(
    'VendorProfile',
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
      // 1-to-1 with the vendor user account.
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
      },
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
      },
      company_name: { type: DataTypes.STRING(200), allowNull: false, validate: { notEmpty: true } },
      // Tax / registration identifiers (EIN, VAT, etc.).
      tax_id: { type: DataTypes.STRING(80), allowNull: true },
      contact_person: { type: DataTypes.STRING(150), allowNull: true },
      contact_email: { type: DataTypes.STRING(128), allowNull: true },
      contact_phone: { type: DataTypes.STRING(40), allowNull: true },
      // { line1, line2, city, state, zip, country }
      address: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      website: { type: DataTypes.STRING(200), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'vendor_profiles',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['user_id'] },
        { fields: ['organization_id'] },
        { fields: ['company_name'] },
      ],
    }
  );

  return VendorProfile;
};
