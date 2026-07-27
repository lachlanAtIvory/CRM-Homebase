#!/usr/bin/env node
// One-time helper: exchange the CRM's OAuth client for a refresh token that
// grants write access to the shared Ivory Google Calendar.
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-calendar-refresh-token.mjs
//
// Opens a browser — sign in as whichever Google account has "Make changes
// to events" on the shared Ivory calendar. Prints a refresh token to store
// as GOOGLE_OAUTH_REFRESH_TOKEN in Vercel. Re-run any time to rotate it.

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first, e.g.:");
  console.error('  GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-calendar-refresh-token.mjs');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt:      "consent",   // forces Google to hand back a refresh_token even on repeat runs
  scope:       ["https://www.googleapis.com/auth/calendar"],
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("No code received — close this tab and try again.");
    return;
  }
  res.end("Done. You can close this tab and check your terminal.");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  console.log("\n─── Refresh token — save this as GOOGLE_OAUTH_REFRESH_TOKEN in Vercel ───\n");
  console.log(tokens.refresh_token
    ?? "(none returned — you may have already granted this app access before. Revoke it at https://myaccount.google.com/permissions and run this script again.)");
  console.log("");
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening your browser to sign in...");
  console.log("Sign in as whichever Google account manages the shared Ivory calendar.\n");
  console.log("If it doesn't open automatically, visit:\n" + authUrl + "\n");
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${authUrl}"`);
});
