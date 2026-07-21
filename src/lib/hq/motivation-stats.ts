import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Motivation dashboard — shared stats + actor helpers.
 *
 * Every button press is a prospect_events row tagged detail.source =
 * "motivation": dials/voicemails/no-answers as type "cold_call" (with
 * detail.result), booked sales calls as type "demo". Phase 4's scoreboard
 * counts the same rows — logging a call here feeds it automatically.
 */

export type DialResult = "dialed" | "voicemail" | "no_answer";

export type MotivationStats = {
  calls:      number;   // all dials today (dialed + voicemail + no_answer)
  dialed:     number;
  voicemail:  number;
  noAnswer:   number;
  booked:     number;   // sales calls booked today
  weekCalls:  number;
  weekBooked: number;
};

export function actorFromEmail(email: string | null | undefined): "ryan" | "lachlan" | "system" {
  const e = (email ?? "").toLowerCase();
  if (e.includes("lachlan")) return "lachlan";
  if (e.includes("ryan"))    return "ryan";
  return "system";
}

/** Midnight today in Sydney, as an ISO instant. */
export function startOfDayAU(): string {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return `${d}T00:00:00+10:00`;
}

/** Midnight Monday of the current Sydney week. */
export function startOfWeekAU(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayIdx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const back = dayIdx < 0 ? 0 : dayIdx;
  const monday = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+10:00`);
  monday.setUTCDate(monday.getUTCDate() - back);
  return monday.toISOString();
}

export async function fetchMotivationStats(
  supabase: SupabaseClient,
  actor: string,
): Promise<MotivationStats> {
  const dayStart  = startOfDayAU();
  const weekStart = startOfWeekAU();

  const { data: rows } = await supabase
    .from("prospect_events")
    .select("type, detail, occurred_at")
    .eq("actor", actor)
    .in("type", ["cold_call", "demo"])
    .eq("detail->>source", "motivation")
    .gte("occurred_at", weekStart)
    .limit(3000);

  const stats: MotivationStats = {
    calls: 0, dialed: 0, voicemail: 0, noAnswer: 0, booked: 0,
    weekCalls: 0, weekBooked: 0,
  };

  for (const r of rows ?? []) {
    const today = (r.occurred_at as string) >= dayStart;
    if (r.type === "demo") {
      stats.weekBooked++;
      if (today) stats.booked++;
      continue;
    }
    stats.weekCalls++;
    if (!today) continue;
    stats.calls++;
    const result = ((r.detail as Record<string, unknown> | null)?.result ?? "dialed") as DialResult;
    if (result === "voicemail")      stats.voicemail++;
    else if (result === "no_answer") stats.noAnswer++;
    else                             stats.dialed++;
  }
  return stats;
}
