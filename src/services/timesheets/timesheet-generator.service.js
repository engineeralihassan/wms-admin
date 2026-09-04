const { Op } = require('sequelize');
const {
  sequelize,
  Timesheet,
  Project,
  ProjectMember,
  User,
  Ticket,
} = require('../../models');
const logger = require('../../config/logger');
const { PERMISSIONS } = require('../../config/rbac');
const { TICKET_PRIORITIES, TICKET_STATUSES } = require('../../utils/ticket.constants');
const {
  TIMESHEET_STATUSES,
  OPEN_STATUSES,
  REMINDER_OFFSETS,
} = require('../../utils/timesheet.constants');
const {
  toUtcDate,
  todayUtc,
  formatDate,
  addDays,
  currentWeekWindow,
  previousWeekWindow,
} = require('../../utils/timesheet.date');
const { ensureWeeklyTimesheet } = require('./timesheet.service');
const emailService = require('../email/email.service');

/**
 * timesheet-generator.service — the three periodic passes the TimesheetJob queue runs.
 * Each pass is idempotent so re-running (e.g. after a crash/retry) is always safe:
 *
 *   generate — for the CURRENT week, create an unsubmitted timesheet for every valid
 *              project member (active membership + contract window covers the week).
 *              The (project_id, user_id, week_start_date) unique key makes it safe to
 *              re-run: existing rows are left untouched.
 *   remind   — for still-open (unsubmitted/rejected) sheets whose due date is near/at,
 *              queue reminder emails, marking each kind once via reminders_sent.
 *   lock     — for open sheets whose lock date has passed, flip them to LOCKED, notify
 *              the org's approvers, and open a Ticket on the owner's behalf so the
 *              backfill request is tracked. Idempotent: only OPEN sheets are swept.
 */

/** Does the owner's contract window cover the given week? Missing dates = open-ended. */
const contractCoversWeek = (profile, weekStart, weekEnd) => {
  if (!profile) return true;
  const wkStart = toUtcDate(weekStart);
  const wkEnd = toUtcDate(weekEnd);
  if (profile.contract_start_date && toUtcDate(profile.contract_start_date) > wkEnd) return false;
  if (profile.contract_end_date && toUtcDate(profile.contract_end_date) < wkStart) return false;
  return true;
};

/**
 * GENERATE pass. Creates the current week's timesheets for every valid member of every
 * active project (optionally scoped to one organization). Returns a small summary.
 */
const runGenerate = async ({ organizationId } = {}) => {
  // "Never miss a member" guarantee. Because the scheduler now runs once a day (not
  // hourly), we generate for BOTH the current week AND the previous week. This closes
  // the two gaps a purely current-week pass could leave:
  //   1. The server was down/idle across a week boundary — the missed week is still
  //      backfilled on the next daily run.
  //   2. A member added late in the prior week still gets that week's sheet.
  // Generation stays idempotent (unique key), so covering an already-generated week is
  // a cheap no-op. The previous week's lock date has usually passed, so those sheets
  // are created directly in a LOCKED state (see targetStatus) — they still exist for
  // the record and can be backfilled by an approver, they just can't be silently
  // "submitted late" past their own lock window.
  const windows = [currentWeekWindow(), previousWeekWindow()];
  const projectWhere = {};
  if (organizationId) projectWhere.organization_id = organizationId;

  const projects = await Project.findAll({
    where: projectWhere,
    attributes: ['id', 'organization_id'],
    include: [
      {
        model: ProjectMember,
        as: 'memberships',
        attributes: ['user_id'],
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'status'],
            include: [
              {
                association: 'profile',
                attributes: ['contract_start_date', 'contract_end_date'],
              },
            ],
          },
        ],
      },
    ],
  });

  const today = todayUtc();
  let created = 0;
  let skipped = 0;
  for (const window of windows) {
    // A backfilled week whose lock date has already passed is created LOCKED, so we
    // never resurrect a submittable window in the past.
    const targetStatus =
      toUtcDate(window.lockDate) <= today
        ? TIMESHEET_STATUSES.LOCKED
        : TIMESHEET_STATUSES.UNSUBMITTED;

    for (const project of projects) {
      for (const membership of project.memberships || []) {
        const user = membership.user;
        if (!user || user.status !== 'active') {
          skipped += 1;
          continue;
        }
        if (!contractCoversWeek(user.profile, window.weekStart, window.weekEnd)) {
          skipped += 1;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const { created: wasCreated } = await sequelize.transaction((transaction) =>
          ensureWeeklyTimesheet(
            {
              organizationId: project.organization_id,
              projectId: project.id,
              ownerUserId: user.id,
              anyDateInWeek: window.weekStart,
              autoGenerated: true,
              status: targetStatus,
            },
            transaction
          )
        );
        if (wasCreated) created += 1;
        else skipped += 1;
      }
    }
  }

  const weeks = windows.map((w) => w.weekStart).join(', ');
  logger.info(`[timesheet:generate] weeks=[${weeks}] created=${created} skipped=${skipped}`);
  return { weeks: windows.map((w) => w.weekStart), created, skipped };
};

/**
 * REMIND pass. For each reminder kind whose offset day has arrived (today >= week
 * start + offset) and hasn't already been sent for a sheet, queue an email to the owner
 * and mark it in reminders_sent. Only sweeps OPEN (unsubmitted/rejected) sheets.
 */
const runRemind = async ({ organizationId } = {}) => {
  const today = todayUtc();
  const where = { status: { [Op.in]: OPEN_STATUSES } };
  if (organizationId) where.organization_id = organizationId;

  const sheets = await Timesheet.findAll({
    where,
    attributes: [
      'id',
      'timesheet_number',
      'user_id',
      'week_start_date',
      'week_end_date',
      'due_date',
      'reminders_sent',
    ],
    include: [{ model: User, as: 'owner', attributes: ['email'] }],
  });

  let queued = 0;
  for (const sheet of sheets) {
    const sent = sheet.reminders_sent || {};
    let dirty = false;
    for (const reminder of REMINDER_OFFSETS) {
      const fireOn = addDays(sheet.week_start_date, reminder.offsetDays);
      if (today >= fireOn && !sent[reminder.key]) {
        if (sheet.owner && sheet.owner.email) {
          emailService.enqueueSafe('timesheet_reminder', sheet.owner.email, {
            timesheetNumber: sheet.timesheet_number,
            weekStart: sheet.week_start_date,
            weekEnd: sheet.week_end_date,
            dueDate: sheet.due_date,
            reminderKind: reminder.key,
            clientUrl: process.env.CLIENT_URL || '',
          });
          queued += 1;
        }
        sent[reminder.key] = true;
        dirty = true;
      }
    }
    if (dirty) {
      // eslint-disable-next-line no-await-in-loop
      await Timesheet.update({ reminders_sent: sent }, { where: { id: sheet.id } });
    }
  }

  logger.info(`[timesheet:remind] queued=${queued} scanned=${sheets.length}`);
  return { queued, scanned: sheets.length };
};

/**
 * LOCK pass. Sweeps OPEN sheets whose lock date has passed: flips them to LOCKED,
 * notifies the org's approvers, and opens a Ticket on the owner's behalf. All of that
 * happens in one transaction per sheet so the lock, ticket, and notification stay
 * consistent; a notification failure never rolls back the lock (fire-and-forget queue).
 */
const runLock = async ({ organizationId } = {}) => {
  const today = todayUtc();
  const where = {
    status: { [Op.in]: OPEN_STATUSES },
    lock_date: { [Op.lte]: formatDate(today) },
  };
  if (organizationId) where.organization_id = organizationId;

  const sheets = await Timesheet.findAll({
    where,
    include: [
      { model: User, as: 'owner', attributes: ['id', 'first_name', 'last_name', 'email'] },
      { model: Project, as: 'project', attributes: ['id', 'name'] },
    ],
  });

  let locked = 0;
  let ticketsOpened = 0;
  for (const sheet of sheets) {
    // eslint-disable-next-line no-await-in-loop
    const ticketCreated = await sequelize.transaction(async (transaction) => {
      // Re-read + lock the row to avoid double-processing across workers.
      const fresh = await Timesheet.findOne({
        where: { id: sheet.id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!fresh || !OPEN_STATUSES.includes(fresh.status)) return false;

      fresh.status = TIMESHEET_STATUSES.LOCKED;
      await fresh.save({ transaction });

      // Open a tracked backfill request ticket on the owner's behalf.
      const ticket = await openLockTicket(sheet, transaction);
      return !!ticket;
    });

    if (ticketCreated) ticketsOpened += 1;
    locked += 1;

    // Notify approvers outside the transaction (fire-and-forget durable queue).
    // eslint-disable-next-line no-await-in-loop
    await notifyApproversOfLock(sheet);
  }

  logger.info(`[timesheet:lock] locked=${locked} tickets=${ticketsOpened} scanned=${sheets.length}`);
  return { locked, tickets_opened: ticketsOpened, scanned: sheets.length };
};

/** Generate the next human-friendly ticket number inside the lock transaction. */
const nextTicketNumber = async (transaction) => {
  const maxId = (await Ticket.max('id', { transaction })) || 0;
  return `TKT-${String(Number(maxId) + 1).padStart(6, '0')}`;
};

/**
 * Open a Ticket recording that a locked timesheet needs an admin to backfill hours.
 * Created directly via the model (this runs in a system/worker context with no request)
 * and attributed to the owner as the creator so it shows in their ticket list.
 */
const openLockTicket = async (sheet, transaction) => {
  const ownerId = sheet.owner ? sheet.owner.id : sheet.user_id;
  const projectName = sheet.project ? sheet.project.name : 'project';
  const ticket_number = await nextTicketNumber(transaction);
  return Ticket.create(
    {
      ticket_number,
      organization_id: sheet.organization_id,
      created_by_id: ownerId,
      assigned_to_id: null,
      subject: `Locked timesheet ${sheet.timesheet_number} — backfill required`,
      description:
        `The weekly timesheet ${sheet.timesheet_number} for "${projectName}" ` +
        `(week ${sheet.week_start_date} to ${sheet.week_end_date}) was not submitted ` +
        `before its lock date (${sheet.lock_date}) and is now locked. ` +
        `Please review and backfill the hours on the owner's behalf if appropriate.`,
      priority: TICKET_PRIORITIES.MEDIUM,
      status: TICKET_STATUSES.OPEN,
      attachments: [],
    },
    { transaction }
  );
};

/** Email the org's timesheet approvers that a sheet locked and needs attention. */
const notifyApproversOfLock = async (sheet) => {
  try {
    const approvers = await User.findAll({
      where: { organization_id: sheet.organization_id, status: 'active' },
      attributes: ['email'],
      include: [
        {
          association: 'role',
          required: true,
          include: [
            {
              association: 'permissions',
              required: true,
              where: { key: PERMISSIONS.TIMESHEET_APPROVE },
              attributes: [],
            },
          ],
          attributes: [],
        },
      ],
    });
    const ownerName = sheet.owner
      ? `${sheet.owner.first_name} ${sheet.owner.last_name}`.trim()
      : 'A team member';
    const data = {
      timesheetNumber: sheet.timesheet_number,
      ownerName,
      projectName: sheet.project ? sheet.project.name : '',
      weekStart: sheet.week_start_date,
      weekEnd: sheet.week_end_date,
      lockDate: sheet.lock_date,
      clientUrl: process.env.CLIENT_URL || '',
    };
    approvers.forEach((a) => {
      if (a.email) emailService.enqueueSafe('timesheet_locked', a.email, data);
    });
  } catch {
    // Never let a notification failure affect the lock sweep.
  }
};

module.exports = {
  runGenerate,
  runRemind,
  runLock,
  // exported for testing
  contractCoversWeek,
};
