const { wrap, escapeHtml } = require('./layout');

/**
 * Template registry.
 *
 * Each template is a pure function: (data) => { subject, html, text }.
 * Dynamic values (organization name, user name, links, custom messages) are
 * injected from `data`. To add a new email type, add one entry here — the
 * enqueue service and worker need no changes.
 *
 * All templates receive an implicit `appName` (from env) merged into data.
 */
const TEMPLATES = {
  /** Sent when a new user (vendor/consultant/org_admin) is created. */
  welcome: (data) => {
    const { firstName = 'there', organizationName = '', appName } = data;
    const orgLine = organizationName
      ? `<p style="margin:0 0 12px;">You have been added to <strong>${escapeHtml(
          organizationName
        )}</strong>.</p>`
      : '';
    return {
      subject: `Welcome to ${appName}`,
      html: wrap({
        appName,
        title: `Welcome, ${escapeHtml(firstName)}!`,
        bodyHtml: `
          ${orgLine}
          <p style="margin:0 0 12px;">Your account has been created successfully.</p>
          <p style="margin:0;">You can now sign in to the admin dashboard using your email and the password provided to you.</p>
        `,
      }),
      text: `Welcome, ${firstName}! Your ${appName} account has been created${
        organizationName ? ` under ${organizationName}` : ''
      }. You can now sign in.`,
    };
  },

  /** Sent when a user requests a password reset. */
  password_reset: (data) => {
    const { firstName = 'there', resetUrl = '#', expiresInMinutes = 10, appName } = data;
    return {
      subject: `Reset your ${appName} password`,
      html: wrap({
        appName,
        title: 'Password reset requested',
        bodyHtml: `
          <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 16px;">We received a request to reset your password. Click the button below to choose a new one. This link expires in ${Number(
            expiresInMinutes
          )} minutes.</p>
          <p style="margin:0 0 20px;">
            <a href="${escapeHtml(
              resetUrl
            )}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;">Reset password</a>
          </p>
          <p style="margin:0;color:#64748b;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        `,
      }),
      text: `Hi ${firstName}, reset your password using this link (expires in ${expiresInMinutes} min): ${resetUrl}`,
    };
  },

  /**
   * Sent when an account is created for someone (org_admin, vendor, consultant).
   * Contains a tokenized activation link where they set their password.
   */
  account_activation: (data) => {
    const {
      firstName = 'there',
      organizationName = '',
      activationUrl = '#',
      expiresInDays = 7,
      appName,
    } = data;
    const orgLine = organizationName
      ? `<p style="margin:0 0 12px;">You've been added to <strong>${escapeHtml(
          organizationName
        )}</strong> on ${escapeHtml(appName)}.</p>`
      : '';
    return {
      subject: `Activate your ${appName} account`,
      html: wrap({
        appName,
        title: `Welcome, ${escapeHtml(firstName)}!`,
        bodyHtml: `
          ${orgLine}
          <p style="margin:0 0 16px;">To get started, set your password and activate your account. This link expires in ${Number(
            expiresInDays
          )} days.</p>
          <p style="margin:0 0 20px;">
            <a href="${escapeHtml(
              activationUrl
            )}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold;">Set your password</a>
          </p>
          <p style="margin:0;color:#64748b;font-size:13px;">If you weren't expecting this, you can safely ignore this email.</p>
        `,
      }),
      text: `Welcome, ${firstName}! Activate your ${appName} account and set your password (link expires in ${expiresInDays} days): ${activationUrl}`,
    };
  },

  /** Sent to the first admin when a new organization is created. */
  organization_welcome: (data) => {
    const { firstName = 'there', organizationName = 'your organization', appName } = data;
    return {
      subject: `Your organization is ready on ${appName}`,
      html: wrap({
        appName,
        title: `${escapeHtml(organizationName)} is set up`,
        bodyHtml: `
          <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 12px;">Your organization <strong>${escapeHtml(
            organizationName
          )}</strong> has been created and you have been assigned as its administrator.</p>
          <p style="margin:0;">You can now sign in and start inviting your team (vendors and consultants).</p>
        `,
      }),
      text: `Hi ${firstName}, your organization "${organizationName}" is ready and you're its admin. Sign in to get started.`,
    };
  },

  // ── Timesheets ──────────────────────────────────────────────────────────────

  /** Sent to approvers when an owner submits a weekly timesheet. */
  timesheet_submitted: (data) => {
    const { timesheetNumber = '', weekStart = '', weekEnd = '', totalHours = 0, appName } = data;
    return {
      subject: `Timesheet ${timesheetNumber} submitted for approval`,
      html: wrap({
        appName,
        title: 'A timesheet is awaiting your approval',
        bodyHtml: `
          <p style="margin:0 0 12px;">Timesheet <strong>${escapeHtml(
            timesheetNumber
          )}</strong> for the week ${escapeHtml(weekStart)} to ${escapeHtml(
          weekEnd
        )} has been submitted.</p>
          <p style="margin:0 0 12px;">Total hours: <strong>${Number(totalHours)}</strong></p>
          <p style="margin:0;">Please review and approve or reject it.</p>
        `,
      }),
      text: `Timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}, ${Number(
        totalHours
      )}h) has been submitted for your approval.`,
    };
  },

  /** Sent to the owner when their timesheet is approved. */
  timesheet_approved: (data) => {
    const { timesheetNumber = '', weekStart = '', weekEnd = '', reviewNote, appName } = data;
    const note = reviewNote
      ? `<p style="margin:12px 0 0;color:#64748b;">Reviewer note: ${escapeHtml(reviewNote)}</p>`
      : '';
    return {
      subject: `Timesheet ${timesheetNumber} approved`,
      html: wrap({
        appName,
        title: 'Your timesheet was approved',
        bodyHtml: `
          <p style="margin:0 0 12px;">Your timesheet <strong>${escapeHtml(
            timesheetNumber
          )}</strong> for the week ${escapeHtml(weekStart)} to ${escapeHtml(
          weekEnd
        )} has been approved.</p>${note}
        `,
      }),
      text: `Your timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}) has been approved.${
        reviewNote ? ` Note: ${reviewNote}` : ''
      }`,
    };
  },

  /** Sent to the owner when their timesheet is rejected (with a reason). */
  timesheet_rejected: (data) => {
    const { timesheetNumber = '', weekStart = '', weekEnd = '', rejectionReason = '', appName } =
      data;
    return {
      subject: `Timesheet ${timesheetNumber} needs changes`,
      html: wrap({
        appName,
        title: 'Your timesheet was sent back',
        bodyHtml: `
          <p style="margin:0 0 12px;">Your timesheet <strong>${escapeHtml(
            timesheetNumber
          )}</strong> for the week ${escapeHtml(weekStart)} to ${escapeHtml(
          weekEnd
        )} was rejected and returned to you for changes.</p>
          <p style="margin:0 0 12px;">Reason: <strong>${escapeHtml(rejectionReason)}</strong></p>
          <p style="margin:0;">Please update the hours and resubmit.</p>
        `,
      }),
      text: `Your timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}) was rejected. Reason: ${rejectionReason}. Please update and resubmit.`,
    };
  },

  /** Sent to the owner when an approver corrects their timesheet for correctness. */
  timesheet_corrected: (data) => {
    const { timesheetNumber = '', weekStart = '', weekEnd = '', totalHours = 0, reviewNote, appName } =
      data;
    const note = reviewNote
      ? `<p style="margin:0 0 12px;">Note from the reviewer: <strong>${escapeHtml(
          reviewNote
        )}</strong></p>`
      : '';
    return {
      subject: `Timesheet ${timesheetNumber} was updated by an administrator`,
      html: wrap({
        appName,
        title: 'Your timesheet was updated',
        bodyHtml: `
          <p style="margin:0 0 12px;">An administrator made changes to your timesheet <strong>${escapeHtml(
            timesheetNumber
          )}</strong> for the week ${escapeHtml(weekStart)} to ${escapeHtml(
          weekEnd
        )} for correctness.</p>
          <p style="margin:0 0 12px;">Updated total hours: <strong>${Number(totalHours)}</strong></p>
          ${note}
          <p style="margin:0;">Please review the changes.</p>
        `,
      }),
      text: `Your timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}) was updated by an administrator for correctness. New total: ${Number(
        totalHours
      )}h.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
    };
  },

  /** Reminder to an owner to submit an unsubmitted timesheet before it locks. */
  timesheet_reminder: (data) => {
    const { timesheetNumber = '', weekStart = '', weekEnd = '', dueDate = '', reminderKind, appName } =
      data;
    const urgency =
      reminderKind === 'due_today'
        ? 'It is due today.'
        : `It is due on ${escapeHtml(dueDate)}.`;
    return {
      subject: `Reminder: submit timesheet ${timesheetNumber}`,
      html: wrap({
        appName,
        title: 'Please submit your timesheet',
        bodyHtml: `
          <p style="margin:0 0 12px;">Your timesheet <strong>${escapeHtml(
            timesheetNumber
          )}</strong> for the week ${escapeHtml(weekStart)} to ${escapeHtml(
          weekEnd
        )} has not been submitted yet.</p>
          <p style="margin:0 0 12px;">${urgency}</p>
          <p style="margin:0;">Please fill in your hours and submit before the deadline to avoid it being locked.</p>
        `,
      }),
      text: `Reminder: your timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}) is not submitted. Due ${dueDate}. Please submit before it locks.`,
    };
  },

  /** Sent to approvers when a timesheet locks unsubmitted and needs a backfill. */
  timesheet_locked: (data) => {
    const {
      timesheetNumber = '',
      ownerName = 'A team member',
      projectName = '',
      weekStart = '',
      weekEnd = '',
      lockDate = '',
      appName,
    } = data;
    return {
      subject: `Timesheet ${timesheetNumber} locked — action needed`,
      html: wrap({
        appName,
        title: 'A timesheet was locked unsubmitted',
        bodyHtml: `
          <p style="margin:0 0 12px;"><strong>${escapeHtml(
            ownerName
          )}</strong> did not submit timesheet <strong>${escapeHtml(
          timesheetNumber
        )}</strong>${projectName ? ` for "${escapeHtml(projectName)}"` : ''} for the week ${escapeHtml(
          weekStart
        )} to ${escapeHtml(weekEnd)}.</p>
          <p style="margin:0 0 12px;">It passed its lock date (${escapeHtml(
            lockDate
          )}) and is now locked. A ticket has been opened to track the backfill request.</p>
          <p style="margin:0;">Please review and backfill the hours on their behalf if appropriate.</p>
        `,
      }),
      text: `${ownerName} did not submit timesheet ${timesheetNumber} (week ${weekStart} to ${weekEnd}); it locked on ${lockDate}. A ticket was opened. Please review and backfill if appropriate.`,
    };
  },
};

/**
 * Render a template by key with the given data. Throws on unknown template.
 * @returns {{ subject: string, html: string, text: string }}
 */
const render = (templateKey, data = {}) => {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown email template: ${templateKey}`);
  }
  const merged = { appName: process.env.APP_NAME || 'WMS Admin', ...data };
  return template(merged);
};

const isValidTemplate = (templateKey) => Object.prototype.hasOwnProperty.call(TEMPLATES, templateKey);

module.exports = { render, isValidTemplate, TEMPLATE_KEYS: Object.keys(TEMPLATES) };
