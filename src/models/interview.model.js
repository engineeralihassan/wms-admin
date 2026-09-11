const { DataTypes } = require('sequelize');
const {
  INTERVIEW_STATUSES,
  INTERVIEW_MODES,
  INTERVIEW_PROVIDERS,
} = require('../utils/ats.constants');

/**
 * Interview = one concrete, scheduled interview for a JobApplication at a given round.
 *
 * A recruiter books it once an application is SHORTLISTED (or already INTERVIEWING).
 * It captures WHEN (scheduled_start/end + timezone), HOW (mode), WHERE/VIA (provider +
 * meeting_url/location), and its outcome (status). The interviewer panel + the candidate
 * live in the companion `interview_participants` table so we can query "is this
 * interviewer already booked in this window?" for conflict detection.
 *
 * The `provider` decides which calendar/meeting integration mints the event:
 *   google | teams  — an external event is created and external_event_id/meeting_url set.
 *   manual          — recruiter supplies the link/location; no third-party call.
 * `provider_meta` stores the raw provider payload (event id, htmlLink, conference data)
 * so we can update/cancel the external event later without re-deriving anything.
 *
 * Relationships:
 *   Organization    1───* Interview               (organization_id)
 *   Job             1───* Interview               (job_id)
 *   JobApplication  1───* Interview               (application_id)
 *   User(organizer) 1───* Interview               (organizer_id — the recruiter)
 *   Interview       1───* InterviewParticipant    (interview_id)
 */
module.exports = (sequelize) => {
  const Interview = sequelize.define(
    'Interview',
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

      // Human-friendly identifier (e.g. "INT-000123"). Unique across the platform.
      interview_number: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
        validate: { notEmpty: true },
      },

      // Multi-tenancy anchor (denormalized from the parent application/job).
      organization_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
      },

      job_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'jobs', key: 'id' },
      },

      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'job_applications', key: 'id' },
      },

      // Which interview round this sits in (one of the parent job's interview_rounds[].key).
      stage_key: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },

      // The recruiter/admin who booked and owns the interview.
      organizer_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },

      // Optional custom title; defaults to "<Round> — <Candidate>" when omitted.
      title: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      // ── When ──────────────────────────────────────────────────────────────────
      // Stored as absolute UTC instants (Sequelize DATE = timestamptz on Postgres);
      // `timezone` records the IANA zone the slot was chosen in, for display + invites.
      scheduled_start: {
        type: DataTypes.DATE,
        allowNull: false,
      },

      scheduled_end: {
        type: DataTypes.DATE,
        allowNull: false,
      },

      duration_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 },
      },

      // IANA timezone identifier the interview was scheduled in (e.g. "Asia/Kolkata").
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },

      // ── How / where ─────────────────────────────────────────────────────────────
      mode: {
        type: DataTypes.ENUM(...Object.values(INTERVIEW_MODES)),
        allowNull: false,
        defaultValue: INTERVIEW_MODES.VIDEO,
      },

      provider: {
        type: DataTypes.ENUM(...Object.values(INTERVIEW_PROVIDERS)),
        allowNull: false,
        defaultValue: INTERVIEW_PROVIDERS.MANUAL,
      },

      // Video join link (Meet/Teams/manual). Null for phone/onsite unless supplied.
      meeting_url: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },

      // Physical location (onsite) or free-text venue/dial-in note.
      location: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      // The provider's event identifier, used to update/cancel the external event.
      external_event_id: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },

      // Raw provider response (htmlLink, conferenceData, calendarId, etc.).
      provider_meta: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      // ── Outcome ─────────────────────────────────────────────────────────────────
      status: {
        type: DataTypes.ENUM(...Object.values(INTERVIEW_STATUSES)),
        allowNull: false,
        defaultValue: INTERVIEW_STATUSES.SCHEDULED,
      },

      // Recruiter-facing agenda/instructions shown to the panel + optionally the candidate.
      notes: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },

      // Post-interview outcome captured on completion (free text; structured feedback
      // can layer on later without a schema change).
      outcome_note: {
        type: DataTypes.STRING(2000),
        allowNull: true,
      },

      // Reason captured when cancelled.
      cancel_reason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
    },
    {
      tableName: 'interviews',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['uuid'] },
        { unique: true, fields: ['interview_number'] },
        { fields: ['organization_id'] },
        { fields: ['organization_id', 'status'] },
        { fields: ['application_id'] },
        { fields: ['application_id', 'status'] },
        { fields: ['job_id'] },
        { fields: ['organization_id', 'status', 'scheduled_start'] },
      ],
    }
  );

  return Interview;
};
