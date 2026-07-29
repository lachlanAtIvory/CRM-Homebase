import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client portal — stats for the public /client/[token] report page.
 *
 * Deliberately selects ONLY started_at, duration_seconds, outcome from
 * `calls` — transcript/summary/raw_payload are never fetched here, so
 * there's no code path for a caller's actual words to reach this page.
 *
 * Kept separate from the page component so the same numbers can later
 * feed the daily client-summary email without duplicating the logic.
 */

const SYDNEY_TZ = "Australia/Sydney";

export type PortalDays = 7 | 30 | 90;

export type PortalActivityItem = {
  outcome:   string;
  startedAt: string;
};

export type PortalStats = {
  clientName:         string;
  days:                PortalDays;
  totalCalls:          number;
  bookings:            number;
  messagesTaken:       number;
  afterHours:          number;
  avgDurationSeconds:  number;
  bookingsDeltaPct:    number | null;   // vs the prior period of equal length; null if prior had 0 bookings
  weeklyBuckets:       number[];        // call counts, oldest bucket first
  recent:              PortalActivityItem[];
};

function isAfterHours(iso: string): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-AU", { timeZone: SYDNEY_TZ, hour: "2-digit", hour12: false }).format(new Date(iso)),
    10,
  );
  return hour < 8 || hour >= 18;
}

export async function fetchPortalStats(
  supabase: SupabaseClient,
  clientId: string,
  clientName: string,
  days: PortalDays,
): Promise<PortalStats> {
  const now         = new Date();
  const rangeStart  = new Date(now.getTime() - days * 86_400_000);
  const priorStart  = new Date(rangeStart.getTime() - days * 86_400_000);
  const rangeStartMs = rangeStart.getTime();

  const { data: rows } = await supabase
    .from("calls")
    .select("started_at, duration_seconds, outcome")
    .eq("client_id", clientId)
    .not("started_at", "is", null)
    .gte("started_at", priorStart.toISOString())
    .order("started_at", { ascending: false })
    .limit(3000);

  // Epoch-millis comparison, not string comparison — a past bug here (the
  // Motivation dashboard's "today" boundary) came from comparing timestamps
  // with different UTC offset notations as plain text.
  const current = (rows ?? []).filter((r) => new Date(r.started_at as string).getTime() >= rangeStartMs);
  const prior   = (rows ?? []).filter((r) => new Date(r.started_at as string).getTime() <  rangeStartMs);

  const totalCalls    = current.length;
  const bookings      = current.filter((r) => r.outcome === "booked").length;
  const messagesTaken = current.filter((r) => r.outcome === "message_taken").length;
  const afterHours    = current.filter((r) => isAfterHours(r.started_at as string)).length;

  const durations = current
    .map((r) => r.duration_seconds as number | null)
    .filter((d): d is number => typeof d === "number");
  const avgDurationSeconds = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0;

  const priorBookings = prior.filter((r) => r.outcome === "booked").length;
  const bookingsDeltaPct = priorBookings > 0
    ? Math.round(((bookings - priorBookings) / priorBookings) * 100)
    : null;

  // Bucket the range into ~weekly slices (min 4, max 8) for the bar mini-chart
  const bucketCount = Math.min(8, Math.max(4, Math.round(days / 7)));
  const bucketMs = (days * 86_400_000) / bucketCount;
  const weeklyBuckets = Array(bucketCount).fill(0) as number[];
  for (const r of current) {
    const age = now.getTime() - new Date(r.started_at as string).getTime();
    const idx = Math.min(bucketCount - 1, Math.floor(age / bucketMs));
    weeklyBuckets[bucketCount - 1 - idx]++;
  }

  const recent: PortalActivityItem[] = current.slice(0, 6).map((r) => ({
    outcome:   (r.outcome as string) ?? "other",
    startedAt: r.started_at as string,
  }));

  return {
    clientName, days, totalCalls, bookings, messagesTaken, afterHours,
    avgDurationSeconds, bookingsDeltaPct, weeklyBuckets, recent,
  };
}

/* ── Presentation helpers (shared with a future daily-email version) ────── */

export function formatOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "booked":        return "Booked an appointment";
    case "message_taken": return "Took a message";
    case "enquiry":       return "Answered an enquiry";
    case "abandoned":      return "Missed call";
    default:               return "Handled a call";
  }
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatRelativeSydney(iso: string): string {
  const d = new Date(iso);
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: SYDNEY_TZ });
  const today = dayFmt.format(new Date());
  const that  = dayFmt.format(d);
  const timeStr = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d).toLowerCase().replace(" ", "");

  if (that === today) return `Today, ${timeStr}`;

  const yesterday = dayFmt.format(new Date(Date.now() - 86_400_000));
  if (that === yesterday) return `Yesterday, ${timeStr}`;

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ, day: "numeric", month: "short",
  }).format(d);
}
