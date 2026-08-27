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
