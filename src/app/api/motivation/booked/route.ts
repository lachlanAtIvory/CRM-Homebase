import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorFromEmail, fetchMotivationStats } from "@/lib/hq/motivation-stats";
import { createCalendarEvent } from "@/lib/hq/google-calendar";

/**
 * Motivation dashboard — book a sales call.
 *
 * Creates the lead for real: a clients row + a deals row at the pipeline's
 * "call_booked" stage (exactly how the app creates deals elsewhere), plus a
 * prospect_events "demo" row so the booking counts on the dashboard and the
 * future scoreboard. Also creates a REAL event on the shared Ivory Google
 * Calendar (createCalendarEvent) — if that credential isn't configured yet,
 * it falls back to a CRM-only meetings row so booking never breaks.
 * Returns fresh stats + the new client id.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = actorFromEmail(user.email);

  let body: {
    business_name?: string;
    contact_name?:  string;
    phone?:         string;
    email?:         string;
    notes?:         string;
    when?:          string;   // ISO — the locked sales-call time
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const businessName = (body.business_name ?? "").trim();
  if (!businessName) {
    return NextResponse.json({ error: "business_name is required" }, { status: 400 });
  }
  const when = new Date(body.when ?? "");
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "when must be a valid date/time — no booking without a locked time" }, { status: 400 });
  }

  // 1. The client record (reuse an existing one on email match — same
  //    dedupe rule the application form uses)
  let clientId: string | null = null;
  const email = (body.email ?? "").trim() || null;
  if (email) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing?.id) clientId = existing.id as string;
  }
  if (!clientId) {
    const { data: created, error } = await supabase
      .from("clients")
      .insert({
        company_name: businessName,
        contact_name: (body.contact_name ?? "").trim() || null,
        phone:        (body.phone ?? "").trim() || null,
        email,
        notes:        (body.notes ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Failed to create client" }, { status: 500 });
    }
    clientId = created.id as string;
  }

  // 2. The pipeline deal — lands in the "Call booked" column
  const { error: dealError } = await supabase
    .from("deals")
    .insert({ client_id: clientId, current_stage: "call_booked" });
  if (dealError) {
    return NextResponse.json({ error: dealError.message }, { status: 500 });
  }

  // 3. The calendar slot — 30 min, on the REAL shared Ivory Google Calendar
  //    when credentials are configured; always also mirrored into the CRM's
  //    own meetings table so /calendar shows it immediately either way.
  const start = when.toISOString();
  const end   = new Date(when.getTime() + 30 * 60_000).toISOString();
  const notesLine = (body.notes ?? "").trim();
  const descriptionLines = [
    body.contact_name ? `Contact: ${body.contact_name}` : null,
    body.phone        ? `Phone: ${body.phone}`          : null,
    email             ? `Email: ${email}`               : null,
    notesLine         ? `\n${notesLine}`                : null,
    "\nBooked via Ivory HQ — Motivation dashboard.",
  ].filter(Boolean).join("\n");

  const googleEvent = await createCalendarEvent({
    title:       `Sales call — ${businessName}`,
    startISO:    start,
    endISO:      end,
    description: descriptionLines,
  });

  await supabase.from("meetings").insert({
    event_id:         googleEvent?.eventId ?? `hq_${crypto.randomUUID()}`,
    title:            `Sales call — ${businessName}`,
    start_time:       start,
    end_time:         end,
    meeting_link:     googleEvent?.htmlLink ?? null,
    attendees:        user.email ? [user.email] : [],
    linked_client_id: clientId,
  });

  // 4. The activity event — today's booked count + future scoreboard
  await supabase.from("prospect_events").insert({
    type:   "demo",
    actor,
    detail: {
      source:        "motivation",
      business_name: businessName,
      contact_name:  body.contact_name || null,
      phone:         body.phone || null,
      email,
      notes:         body.notes || null,
      when:          when.toISOString(),
      client_id:     clientId,
    },
  });

  const stats = await fetchMotivationStats(supabase, actor);
  return NextResponse.json({ ok: true, clientId, stats });
}
