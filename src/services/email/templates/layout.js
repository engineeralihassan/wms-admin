/**
 * Shared HTML shell for all emails, so every template has consistent branding.
 * Templates provide `title` and `bodyHtml`; this wraps them.
 */
const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const wrap = ({ title, bodyHtml, appName = 'WMS Admin' }) => `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:#1e3a8a;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
                ${escapeHtml(appName)}
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
                This is an automated message from ${escapeHtml(appName)}. Please do not reply.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

module.exports = { wrap, escapeHtml };
