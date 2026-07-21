import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Motivation dashboard — shared stats + actor helpers.
 *
 * Every button press is a prospect_events row tagged detail.source =
 * "motivation": dials/voicemails/no-answers as type "cold_call" (with
 * detail.result), booked sales calls as type "demo". Phase 4's scoreboard
 * counts the same rows — logging a call here feeds it automatically.
 */

export type DialResult = "dialed" | "voicemail" | "no_answer" | "callback";

export type MotivationStats = {
  calls:      number;   // all dials today (dialed + voicemail + no_answer + callback)
  dialed:     number;
  voicemail:  number;
  noAnswer:   number;
  callbacks:  number;   // callbacks scheduled today
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
    calls: 0, dialed: 0, voicemail: 0, noAnswer: 0, callbacks: 0, booked: 0,
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
    else if (result === "callback")  stats.callbacks++;
    else                             stats.dialed++;
  }
  return stats;
}

/* ── History: streaks, personal bests, due-for-a-yes ─────────────────────── */

export type MotivationHistory = {
  /** Sydney-dated daily totals for the last 60 days, EXCLUDING today. */
  days: { date: string; calls: number; booked: number }[];
  bestDayCalls:  number;   // best single day before today
  bestHourCalls: number;   // best single hour before the current hour
  allCalls:      number;   // all-time dials
  allBooked:     number;   // all-time bookings
  dialsSinceLastBooked: number;
};

export async function fetchMotivationHistory(
  supabase: SupabaseClient,
  actor: string,
): Promise<MotivationHistory> {
  const { data: rows } = await supabase
    .from("prospect_events")
    .select("type, occurred_at")
    .eq("actor", actor)
    .in("type", ["cold_call", "demo"])
    .eq("detail->>source", "motivation")
    .order("occurred_at", { ascending: true })
    .limit(10000);

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" });
  const hourFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", hour: "2-digit", hour12: false,
  });
  const today = dayFmt.format(new Date());
  const currentHour = `${today}T${hourFmt.format(new Date())}`;

  const byDay  = new Map<string, { calls: number; booked: number }>();
  const byHour = new Map<string, number>();
  let allCalls = 0, allBooked = 0, dialsSinceLastBooked = 0;

  for (const r of rows ?? []) {
    const at = new Date(r.occurred_at as string);
    const day = dayFmt.format(at);
    const entry = byDay.get(day) ?? { calls: 0, booked: 0 };
    if (r.type === "demo") {
      entry.booked++;
      allBooked++;
      dialsSinceLastBooked = 0;
    } else {
      entry.calls++;
      allCalls++;
      dialsSinceLastBooked++;
      const hour = `${day}T${hourFmt.format(at)}`;
      byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
    }
    byDay.set(day, entry);
  }

  let bestDayCalls = 0;
  const days: MotivationHistory["days"] = [];
  for (const [date, e] of byDay) {
    if (date === today) continue;
    days.push({ date, ...e });
    if (e.calls > bestDayCalls) bestDayCalls = e.calls;
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  let bestHourCalls = 0;
  for (const [hour, calls] of byHour) {
    if (hour === currentHour) continue;
    if (calls > bestHourCalls) bestHourCalls = calls;
  }

  return {
    days: days.slice(-60),
    bestDayCalls, bestHourCalls,
    allCalls, allBooked, dialsSinceLastBooked,
  };
}
