const { DataTypes } = require('sequelize');
const {
  INTERVIEW_PARTICIPANT_ROLES,
  INTERVIEW_RESPONSE_STATUSES,
} = require('../utils/ats.constants');

module.exports = (sequelize) => {
  const InterviewParticipant = sequelize.define(
    'InterviewParticipant',
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

      interview_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'interviews', key: 'id' },
      },

      // The platform user, when the participant is an interviewer/organizer. Null for
      // the external candidate.
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },

      role: {
        type: DataTypes.ENUM(...Object.values(INTERVIEW_PARTICIPANT_ROLES)),
        allowNull: false,
      },

      // Email snapshot the invite is addressed to (from the user or the candidate).
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
      },

      // Display name snapshot (for invite rendering; survives user/candidate changes).
      name: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      response_status: {
        type: DataTypes.ENUM(...Object.values(INTERVIEW_RESPONSE_STATUSES)),
        allowNull: false,
        defaultValue: INTERVIEW_RESPONSE_STATUSES.PENDING,
      },
    },
    {
      tableName: 'interview_participants',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { fields: ['organization_id'] },
        { fields: ['interview_id'] },
        { fields: ['user_id', 'interview_id'] },
        // A user appears once per interview.
        { unique: true, fields: ['interview_id', 'user_id'] },
      ],
    }
  );

  return InterviewParticipant;
};
