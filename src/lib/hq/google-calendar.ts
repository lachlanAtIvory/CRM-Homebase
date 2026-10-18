import { google } from "googleapis";

/**
 * Shared Ivory Google Calendar — write access via OAuth (not a service
 * account: the Workspace org's iam.disableServiceAccountKeyCreation policy
 * blocks key downloads, so we authenticate as whichever real Google account
 * granted consent instead).
 *
 * Used by both Motivation buttons (Sales Call Booked + Callback Scheduled)
 * so a booking made through either shows up on the real calendar the team
 * looks at, not just the CRM's own `meetings` table.
 *
 * Env vars (Vercel):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN — minted once via scripts/get-calendar-refresh-token.mjs
 *   GOOGLE_CALENDAR_ID         — the shared Ivory calendar's ID
 *
 * If any are missing, createCalendarEvent resolves to null instead of
 * throwing — callers fall back to CRM-only scheduling so a credential
 * hiccup never blocks a booking mid-call.
 */

let cachedAuth: InstanceType<typeof google.auth.OAuth2> | null = null;

function getAuth(): InstanceType<typeof google.auth.OAuth2> | null {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken  = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  if (cachedAuth) return cachedAuth;

  cachedAuth = new google.auth.OAuth2(clientId, clientSecret);
  cachedAuth.setCredentials({ refresh_token: refreshToken });
  return cachedAuth;
}

export type CalendarEventInput = {
  title:      string;
  startISO:   string;
  endISO:     string;
  description?: string;
};

export type CalendarEventResult = {
  eventId: string;
  htmlLink: string | null;
};

/**
 * Creates a real event on the shared Ivory Google Calendar.
 * Returns null (never throws) if credentials are missing or the API call
 * fails — callers should treat null as "still booked in the CRM, just not
 * synced to Google yet" rather than an error.
 *
 * Deliberately no `attendees` on the insert. Adding a staff member as an
 * attendee makes Google auto-mirror the event onto their personal
 * calendar as an invite — since Lachlan and Ryan already have the Ivory
 * calendar itself added in their own Google Calendar, that mirroring
 * just duplicated every booking. One event, one calendar, visible to
 * anyone who's subscribed to it.
 */
export async function createCalendarEvent(
  input: CalendarEventInput,
): Promise<CalendarEventResult | null> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const auth = getAuth();
  if (!auth || !calendarId) return null;

  try {
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary:     input.title,
        description: input.description,
        start: { dateTime: input.startISO, timeZone: "Australia/Sydney" },
        end:   { dateTime: input.endISO,   timeZone: "Australia/Sydney" },
        reminders: { useDefault: true },
      },
    });
    if (!res.data.id) return null;
    return { eventId: res.data.id, htmlLink: res.data.htmlLink ?? null };
  } catch (e) {
    console.error("Google Calendar event creation failed:", e);
    return null;
  }
}

export type CalendarEventSummary = {
  id: string;
  title: string;
  /** ISO instant, or a plain date ("2026-10-20") for an all-day event. */
  start: string;
  end: string;
  allDay: boolean;
};

/**
 * Lists what is already on the shared Ivory Google Calendar between two
 * instants, so the booking buttons never offer a time that's taken.
 * Returns null (never throws) if credentials are missing or Google can't be
 * reached; callers then fall back to the CRM's own meetings table.
 * Events marked "free" (transparent) and cancelled ones are skipped.
 */
export async function listCalendarEvents(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<CalendarEventSummary[] | null> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const auth = getAuth();
  if (!auth || !calendarId) return null;

  try {
    const calendar = google.calendar({ version: "v3", auth });
    const out: CalendarEventSummary[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await calendar.events.list({
        calendarId,
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      for (const e of res.data.items ?? []) {
        if (e.status === "cancelled" || e.transparency === "transparent") continue;
        const allDay = !e.start?.dateTime;
        const start = e.start?.dateTime ?? e.start?.date;
        const end = e.end?.dateTime ?? e.end?.date;
        if (!e.id || !start || !end) continue;
        out.push({ id: e.id, title: e.summary ?? "", start, end, allDay });
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return out;
  } catch (e) {
    console.error("Google Calendar event listing failed:", e);
    return null;
  }
}
