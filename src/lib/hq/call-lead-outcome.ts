import type { SupabaseClient } from "@supabase/supabase-js";
import { actorFromEmail, fetchMotivationStats } from "./motivation-stats";
import { bookSalesCall } from "./book-sales-call";
import {
  fetchTabCounts, formatNoteLine, isMissingTable, SALES_CALL_WITH,
  type CallLead, type CallLeadNote, type Outcome, type SalesCallWith,
} from "./call-leads";

/**
 * Call list — log a note or a call outcome against a lead.
 *
 *   note            save a note, nothing else changes
 *   no_answer       tried, nobody picked up
 *   voicemail       left a message
 *   not_interested  spoke to them, no
 *   wrong_number    number is wrong or the business has closed
 *   do_not_call     asked not to be called again
 *   callback        needs `when` (an ISO instant; the screen sends Sydney time)
 *   booked          needs `when` and `with`; books the sales call for real
 *
 * Every outcome is also logged as a prospect_events row tagged
 * source "motivation", so it counts on the Motivation dashboard and the
 * scoreboard exactly like the buttons there. Callbacks live on the lead
 * (they show in the Callbacks tab) — deliberately NOT on the shared Google
 * Calendar or in the global task reminders, which every signed-in person sees.
 */

export type OutcomeBody = {
  outcome?: string;
  note?: string;
  when?: string;
  with?: string;
  contact_name?: string;
  email?: string;
};

export type OutcomeResponse = { status: number; json: Record<string, unknown> };

const OUTCOMES: Outcome[] = [
  "note", "no_answer", "voicemail", "not_interested",
  "wrong_number", "do_not_call", "callback", "booked",
];

/** What the Motivation counters call each outcome. */
const DIAL_RESULT: Record<Exclude<Outcome, "note">, "dialed" | "voicemail" | "no_answer" | "callback"> = {
  no_answer: "no_answer",
  voicemail: "voicemail",
  not_interested: "dialed",
  wrong_number: "dialed",
  do_not_call: "dialed",
  callback: "callback",
  booked: "dialed",
};

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): OutcomeResponse =>
  ({ status, json: { error, ...extra } });

export async function applyOutcome(
  supabase: SupabaseClient,
  user: { email?: string | null },
  id: string,
  body: OutcomeBody,
): Promise<OutcomeResponse> {
  const actor = actorFromEmail(user.email);

  const outcome = body.outcome as Outcome;
  if (!OUTCOMES.includes(outcome)) return fail(400, `Invalid outcome: ${body.outcome}`);
  const note = (body.note ?? "").trim().slice(0, 5000);
  if (outcome === "note" && !note) return fail(400, "Write a note first.");

  const { data: leadRow, error: leadError } = await supabase
    .from("call_leads").select("*").eq("id", id).maybeSingle();
  if (leadError) return fail(isMissingTable(leadError) ? 503 : 500, leadError.message);
  if (!leadRow) return fail(404, "Lead not found");
  const lead = leadRow as CallLead;

  // Outcomes that need a time
  let when: Date | null = null;
  if (outcome === "callback" || outcome === "booked") {
    when = new Date(body.when ?? "");
    if (Number.isNaN(when.getTime())) return fail(400, "Pick a date and time first.");
  }
  let withWhom: SalesCallWith | null = null;
  if (outcome === "booked") {
    if (lead.status === "booked") return fail(409, "A sales call is already booked for this lead.");
    if (!SALES_CALL_WITH.includes(body.with as SalesCallWith)) return fail(400, "Choose who the sales call is with.");
    withWhom = body.with as SalesCallWith;
  }

  const now = new Date();
  const warnings: string[] = [];
  let clientId: string | null = null;

  // Book first: if it fails, nothing about the lead changes and he can retry.
  if (outcome === "booked" && when && withWhom) {
    const { data: history } = await supabase
      .from("call_lead_notes")
      .select("outcome, body, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true })
      .limit(30);

    // Everything the caller learned travels with the booking, so whoever
    // takes the sales call can read the pain points before dialling in.
    const lines = [
      [lead.category, lead.address, lead.website].filter(Boolean).join(" · "),
      "Caller notes:",
      ...((history ?? []) as Pick<CallLeadNote, "outcome" | "body" | "occurred_at">[]).map(formatNoteLine),
      note ? formatNoteLine({ outcome: "booked", body: note, occurred_at: now.toISOString() }) : null,
    ].filter(Boolean) as string[];

    const booking = await bookSalesCall(
      supabase,
      { actor, userEmail: user.email ?? null },
      {
        businessName: lead.business_name,
        contactName:  body.contact_name,
        phone:        lead.phone ?? undefined,
        email:        (body.email ?? "").trim() || lead.email || undefined,
        notes:        lines.join("\n").slice(0, 3000),
        when,
        withWhom,
        eventDetail:  { via: "call_list", lead_id: id },
        via:          "Booked via Ivory HQ — Call List.",
      },
    );
    if (!booking.ok) return fail(booking.status, booking.error);
    clientId = booking.clientId;
  }

  // The note / timeline entry
  const { data: noteRow, error: noteError } = await supabase
    .from("call_lead_notes")
    .insert({
      lead_id: id,
      outcome,
      body: note || null,
      actor,
      created_by: user.email ?? null,
      occurred_at: now.toISOString(),
    })
    .select("id, lead_id, outcome, body, actor, created_by, occurred_at")
    .single();
  if (noteError) warnings.push(`The note wasn't saved: ${noteError.message}`);

  // The lead itself
  const patch: Record<string, unknown> = {};
  if (outcome !== "note") {
    patch.attempts = lead.attempts + 1;
    patch.last_called_at = now.toISOString();
  }
  switch (outcome) {
    case "no_answer":
    case "voicemail":
      // A missed callback attempt is still a promised callback until he reschedules or closes it.
      if (lead.status !== "callback") patch.status = outcome;
      break;
    case "not_interested":
    case "wrong_number":
    case "do_not_call":
      patch.status = outcome;
      patch.callback_at = null;
      break;
    case "callback":
      patch.status = "callback";
      patch.callback_at = when!.toISOString();
      break;
    case "booked":
      patch.status = "booked";
      patch.callback_at = null;
      patch.client_id = clientId;
      break;
  }

  let updated = lead;
  if (Object.keys(patch).length) {
    const { data, error } = await supabase
      .from("call_leads").update(patch).eq("id", id).select("*").single();
    if (error) {
      return fail(500, `Logged, but the lead didn't update: ${error.message}`, { note: noteRow ?? null });
    }
    updated = data as CallLead;
  }

  // Scoreboard: same rows the Motivation buttons write.
  if (outcome !== "note") {
    const { error: eventError } = await supabase.from("prospect_events").insert({
      type: "cold_call",
      actor,
      detail: {
        source: "motivation",
        via: "call_list",
        result: DIAL_RESULT[outcome],
        lead_id: id,
        business_name: lead.business_name,
        ...(outcome === "callback" && when ? { when: when.toISOString() } : {}),
      },
    });
    if (eventError) warnings.push("The call was saved but didn't count on the scoreboard.");
  }

  const [stats, counts] = await Promise.all([
    fetchMotivationStats(supabase, actor),
    fetchTabCounts(supabase),
  ]);
  return {
    status: 200,
    json: {
      ok: true,
      lead: updated,
      note: noteRow ?? null,
      stats,
      counts,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    },
  };
}
