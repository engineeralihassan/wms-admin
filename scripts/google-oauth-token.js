/**
 * One-off helper to generate a Google Calendar OAuth **refresh token** for local
 * interview-scheduling testing.
 *
 * It spins up a tiny local web server on the redirect URI you registered in the Google
 * Cloud console, opens (or prints) the consent URL, and after you approve, exchanges the
 * returned code for tokens and prints the refresh token to paste into your env file.
 *
 * Usage:
 *   GOOGLE_CALENDAR_CLIENT_ID=... GOOGLE_CALENDAR_CLIENT_SECRET=... \
 *     node scripts/google-oauth-token.js
 *
 * The redirect URI defaults to http://localhost:3001/oauth2callback — it MUST exactly
 * match one of the "Authorized redirect URIs" on your OAuth client.
 */
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_HELPER_PORT || 3001);
const REDIRECT_URI = process.env.OAUTH_HELPER_REDIRECT || `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nMissing GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET env vars.');
  console.error('Run it like:');
  console.error(
    '  GOOGLE_CALENDAR_CLIENT_ID=xxx GOOGLE_CALENDAR_CLIENT_SECRET=yyy node scripts/google-oauth-token.js\n'
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// calendar.events is enough to create/update/delete events + Meet links.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline', // ask for a refresh token
  prompt: 'consent', // force a refresh token even on repeat runs
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Authorization failed: ${err}`);
    console.error(`\nAuthorization failed: ${err}\n`);
    server.close();
    process.exit(1);
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<h2>Success!</h2><p>Refresh token generated. You can close this tab and return to your terminal.</p>'
    );

    console.log('\n============================================================');
    console.log(' Google Calendar OAuth tokens');
    console.log('============================================================');
    if (tokens.refresh_token) {
      console.log('\nGOOGLE_CALENDAR_REFRESH_TOKEN=' + tokens.refresh_token);
      console.log('\nPaste the line above into config.DEVELOPMENT.env');
    } else {
      console.log(
        '\nNo refresh_token returned. This usually means you already granted access.'
      );
      console.log(
        'Revoke it at https://myaccount.google.com/permissions and run this script again.'
      );
    }
    console.log('\n============================================================\n');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Token exchange failed: ${e.message}`);
    console.error(`\nToken exchange failed: ${e.message}\n`);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('\n1) Open this URL in your browser (the one logged into your Google account):\n');
  console.log(authUrl);
  console.log(
    `\n2) Approve access. Google will redirect back to ${REDIRECT_URI} and this script will print your refresh token.\n`
  );
});
