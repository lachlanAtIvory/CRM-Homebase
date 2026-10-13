import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorDisplayName, actorFromEmail, fetchMotivationStats } from "@/lib/hq/motivation-stats";
import { createCalendarEvent } from "@/lib/hq/google-calendar";

/**
 * Motivation dashboard — schedule a callback.
 *
 * Creates four things at once:
 *  1. a REAL event on the shared Ivory Google Calendar (falls back to a
 *     CRM-only meetings row if the credential isn't configured),
 *  2. a meetings row mirroring it so the callback shows on /calendar,
 *  3. a tasks row with due date+time so the CRM's reminder system pings
 *     10 minutes before,
 *  4. a prospect_events cold_call row (result "callback") so it counts as
 *     a dial on the dashboard and the future scoreboard.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = actorFromEmail(user.email);

  let body: { name?: string; phone?: string; when?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const when = new Date(body.when ?? "");
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "when must be a valid date/time" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();
  const note  = (body.note ?? "").trim();
  const bookedBy = actorDisplayName(actor);
  const title = `Callback — ${name}${phone ? ` (${phone})` : ""} · ${bookedBy}`;

  // 1. Calendar slot (15 min) — real Google Calendar event when configured,
  //    always mirrored into the CRM's own meetings table either way.
  const start = when.toISOString();
  const end   = new Date(when.getTime() + 15 * 60_000).toISOString();

  const googleEvent = await createCalendarEvent({
    title,
    startISO:    start,
    endISO:      end,
    description: [
      `Booked by: ${bookedBy}`,
      phone ? `Phone: ${phone}` : null,
      note  ? `\n${note}`       : null,
      "\nScheduled via Ivory HQ — Motivation dashboard.",
    ].filter(Boolean).join("\n"),
  });

  const { error: meetingError } = await supabase.from("meetings").insert({
    event_id:     googleEvent?.eventId ?? `hq_cb_${crypto.randomUUID()}`,
    title,
    start_time:   start,
    end_time:     end,
    meeting_link: googleEvent?.htmlLink ?? null,
    attendees:    user.email ? [user.email] : [],
  });
  if (meetingError) {
    return NextResponse.json({ error: meetingError.message }, { status: 500 });
  }

  // 2. Task with due date+time in Sydney → reminder fires 10 min before
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  await supabase.from("tasks").insert({
    client_id: null,
    title:     `${title}${note ? ` — ${note}` : ""}`,
    due_date:  `${get("year")}-${get("month")}-${get("day")}`,
    due_time:  `${get("hour")}:${get("minute")}`,
  });

  // 3. The dial log
  await supabase.from("prospect_events").insert({
    type:   "cold_call",
    actor,
    detail: { source: "motivation", result: "callback", name, phone, when: when.toISOString(), note },
  });

  const stats = await fetchMotivationStats(supabase, actor);
  return NextResponse.json({ ok: true, stats });
}
