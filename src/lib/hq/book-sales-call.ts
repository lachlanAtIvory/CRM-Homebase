import type { SupabaseClient } from "@supabase/supabase-js";
import { createCalendarEvent } from "./google-calendar";
import { actorDisplayName, type Actor } from "./motivation-stats";

/**
 * Book a sales call — the one place this happens.
 *
 * Used by the Motivation "Sales call booked" button and by the Call List.
 * Creates the lead for real: a clients row (reusing one with the same email)
 * + a deals row at the pipeline's "call_booked" stage, a REAL event on the
 * shared Ivory Google Calendar (falls back to a CRM-only meetings row if the
 * credential isn't configured), a mirrored meetings row so /calendar shows
 * it straight away, and a prospect_events "demo" row so the booking counts
 * on the dashboard and scoreboard.
 */

export type SalesCallWithWhom = "ryan" | "lachlan" | "either";

export type BookingInput = {
  businessName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  when: Date;
  /** Who takes the call. Set by the cold caller; the founders booking for themselves leave it out. */
  withWhom?: SalesCallWithWhom;
  /** Extra fields recorded on the "demo" event (e.g. which lead it came from). */
  eventDetail?: Record<string, unknown>;
  /** Last line of the calendar description. */
  via?: string;
};

export type BookingResult =
  | { ok: true; clientId: string }
  | { ok: false; status: number; error: string };

const WITH_LABEL: Record<SalesCallWithWhom, string> = {
  ryan: "Ryan",
  lachlan: "Lachlan",
  either: "Ryan or Lachlan",
};

export async function bookSalesCall(
  supabase: SupabaseClient,
  who: { actor: Actor; userEmail: string | null },
  input: BookingInput,
): Promise<BookingResult> {
  const businessName = input.businessName.trim();
  const email = (input.email ?? "").trim() || null;

  // 1. The client record (reuse an existing one on email match — same
  //    dedupe rule the application form uses)
  let clientId: string | null = null;
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
        contact_name: (input.contactName ?? "").trim() || null,
        phone:        (input.phone ?? "").trim() || null,
        email,
        notes:        (input.notes ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, status: 500, error: error?.message ?? "Failed to create client" };
    }
    clientId = created.id as string;
  }

  // 2. The pipeline deal — lands in the "Call booked" column
  const { error: dealError } = await supabase
    .from("deals")
    .insert({ client_id: clientId, current_stage: "call_booked" });
  if (dealError) return { ok: false, status: 500, error: dealError.message };

  // 3. The calendar slot — 30 min, on the REAL shared Ivory Google Calendar
  //    when credentials are configured; always also mirrored into the CRM's
  //    own meetings table so /calendar shows it immediately either way.
  const start = input.when.toISOString();
  const end   = new Date(input.when.getTime() + 30 * 60_000).toISOString();
  const bookedBy = actorDisplayName(who.actor, who.userEmail);
  const forWhom = input.withWhom ? WITH_LABEL[input.withWhom] : null;
  const title = `Sales call — ${businessName} · ${bookedBy}${forWhom ? ` → ${forWhom}` : ""}`;
  const notesLine = (input.notes ?? "").trim();
  const description = [
    `Booked by: ${bookedBy}`,
    forWhom                ? `Sales call with: ${forWhom}`    : null,
    input.contactName      ? `Contact: ${input.contactName}`  : null,
    input.phone            ? `Phone: ${input.phone}`          : null,
    email                  ? `Email: ${email}`                : null,
    notesLine              ? `\n${notesLine}`                 : null,
    `\n${input.via ?? "Booked via Ivory HQ — Motivation dashboard."}`,
  ].filter(Boolean).join("\n");

  const googleEvent = await createCalendarEvent({ title, startISO: start, endISO: end, description });

  await supabase.from("meetings").insert({
    event_id:         googleEvent?.eventId ?? `hq_${crypto.randomUUID()}`,
    title,
    start_time:       start,
    end_time:         end,
    meeting_link:     googleEvent?.htmlLink ?? null,
    attendees:        who.userEmail ? [who.userEmail] : [],
    linked_client_id: clientId,
  });

  // 4. The activity event — today's booked count + future scoreboard
  await supabase.from("prospect_events").insert({
    type:   "demo",
    actor:  who.actor,
    detail: {
      source:        "motivation",
      business_name: businessName,
      contact_name:  input.contactName || null,
      phone:         input.phone || null,
      email,
      notes:         input.notes || null,
      when:          input.when.toISOString(),
      client_id:     clientId,
      ...(input.withWhom ? { with: input.withWhom } : {}),
      ...input.eventDetail,
    },
  });

  return { ok: true, clientId };
}
