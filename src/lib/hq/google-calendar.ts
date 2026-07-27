import { google } from "googleapis";

/**
 * Shared Ivory Google Calendar — write access via a service account.
 *
 * Used by both Motivation buttons (Sales Call Booked + Callback Scheduled)
 * so a booking made through either shows up on the real calendar the team
 * looks at, not just the CRM's own `meetings` table.
 *
 * Env vars (Vercel):
 *   GOOGLE_SERVICE_ACCOUNT_KEY — the full service-account JSON, as one string
 *   GOOGLE_CALENDAR_ID         — the shared Ivory calendar's ID
 *
 * If either is missing, createCalendarEvent resolves to null instead of
 * throwing — callers fall back to CRM-only scheduling so a credential
 * hiccup never blocks a booking mid-call.
 */

let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null;

function getAuth(): InstanceType<typeof google.auth.JWT> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  if (cachedAuth) return cachedAuth;

  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
    return null;
  }

  cachedAuth = new google.auth.JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return cachedAuth;
}

export type CalendarEventInput = {
  title:      string;
  startISO:   string;
  endISO:     string;
  description?: string;
  attendeeEmails?: string[];
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
        attendees: input.attendeeEmails?.map((email) => ({ email })),
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
