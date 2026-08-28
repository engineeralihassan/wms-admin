const { DataTypes } = require('sequelize');
const { tokenTypes } = require('../config/tokens');

const token_type = [
  tokenTypes.REFRESH,
  tokenTypes.RESET_PASSWORD,
  tokenTypes.VERIFY_EMAIL,
  tokenTypes.INVITE,
];

module.exports = (sequelize) => {
  const Token = sequelize.define(
    'Token',
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
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // TEXT (not STRING/varchar255): JWTs with embedded claims can exceed 255 chars.
      token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM,
        values: token_type,
        defaultValue: token_type[0],
        allowNull: false,
      },
      expires: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      blacklisted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'tokens',
      timestamps: true,
      indexes: [
        {
          name: 'tokens_pkey',
          unique: true,
          fields: [{ name: 'id' }],
        },
        // Hot lookup path: verify/revoke tokens for a user by type quickly at scale.
        { fields: ['user_id', 'type', 'blacklisted'] },
        // Supports pruning expired tokens without a full scan.
        { fields: ['expires'] },
      ],
    }
  );

  return Token;
};
