import type { SupabaseClient } from "@supabase/supabase-js";
import { listCalendarEvents, type CalendarEventSummary } from "./google-calendar";
import {
  checkBookable, computeSlots, DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS, toBusy,
  type BookableResult, type Block, type Busy, type DaySlots, type Person, type RawEvent, type Window,
} from "./availability";
import { isMissingAccessSetup } from "./access";

/**
 * Loading what the slot engine needs: the weekly hours, time off, and what's
 * already booked. Everything here runs on the server with the service-role
 * client, after the route has checked the person may use the Call List.
 *
 * "Already booked" comes from the shared Google Calendar (so anything anyone
 * adds there counts, not just bookings made in the CRM), combined with the
 * CRM's own meetings table. If Google can't be reached, the meetings table
 * alone is used and the result says so.
 */

export type Rules = {
  windows: Window[];
  blocks: Block[];
  /** At least one weekly window exists, so availability is switched on. */
  configured: boolean;
  /** The availability migration hasn't been run yet. */
  setupNeeded: boolean;
};

const hhmm = (t: unknown) => String(t ?? "").slice(0, 5);

export async function loadRules(admin: SupabaseClient, now = new Date()): Promise<Rules> {
  const [w, b] = await Promise.all([
    admin.from("availability_windows").select("person, weekday, start_time, end_time"),
    admin.from("availability_blocks").select("person, starts_at, ends_at").gte("ends_at", now.toISOString()),
  ]);
  if (w.error) {
    return { windows: [], blocks: [], configured: false, setupNeeded: isMissingAccessSetup(w.error) };
  }
  const windows: Window[] = (w.data ?? []).map((r) => ({
    person: r.person as Person,
    weekday: Number(r.weekday),
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
  }));
  const blocks: Block[] = (b.data ?? []).map((r) => ({
    person: r.person as Person, starts_at: r.starts_at as string, ends_at: r.ends_at as string,
  }));
  return { windows, blocks, configured: windows.length > 0, setupNeeded: false };
}

export type BusyResult = { busy: Busy[]; source: "calendar" | "crm-only" };

/** Everything booked between two instants. */
export async function loadBusy(admin: SupabaseClient, fromISO: string, toISO: string): Promise<BusyResult> {
  const google = await listCalendarEvents(fromISO, toISO);

  const { data: rows } = await admin
    .from("meetings")
    .select("event_id, title, start_time, end_time")
    .lt("start_time", toISO)
    .gt("end_time", fromISO);

  const seen = new Set<string>();
  const events: RawEvent[] = [];
  for (const e of (google ?? []) as CalendarEventSummary[]) {
    seen.add(e.id);
    events.push({ title: e.title, start: e.start, end: e.end, allDay: e.allDay });
  }
  // The CRM's own rows cover bookings made here (even if Google was unreachable) without double counting.
  for (const m of rows ?? []) {
    if (seen.has(m.event_id as string)) continue;
    events.push({ title: (m.title as string) ?? "", start: m.start_time as string, end: m.end_time as string });
  }
  return { busy: toBusy(events), source: google ? "calendar" : "crm-only" };
}

export type SlotsResult = {
  /** False until someone has set up hours; the booking form then falls back to a free time picker. */
  configured: boolean;
  setupNeeded: boolean;
  days: DaySlots[];
  /** Where "already booked" came from. */
  source: "calendar" | "crm-only";
  horizonDays: number;
};

export async function getSlots(admin: SupabaseClient, days = DEFAULT_HORIZON_DAYS, now = new Date()): Promise<SlotsResult> {
  const horizon = Math.min(Math.max(Math.floor(days) || DEFAULT_HORIZON_DAYS, 1), MAX_HORIZON_DAYS);
  const rules = await loadRules(admin, now);
  if (!rules.configured) {
    return { configured: false, setupNeeded: rules.setupNeeded, days: [], source: "crm-only", horizonDays: horizon };
  }
  const to = new Date(now.getTime() + (horizon + 1) * 86400000);
  const { busy, source } = await loadBusy(admin, now.toISOString(), to.toISOString());
  return {
    configured: true,
    setupNeeded: false,
    days: computeSlots({ now, windows: rules.windows, blocks: rules.blocks, busy, days: horizon }),
    source,
    horizonDays: horizon,
  };
}

/**
 * The last-second check when someone actually books: is this exact time still
 * free for this person? `requireWindow` also insists it's inside their hours,
 * but only when hours have been set up at all (before that, any free time is allowed).
 */
export async function checkSlotBookable(
  admin: SupabaseClient,
  when: Date,
  person: Person | "either",
  requireWindow: boolean,
  now = new Date(),
): Promise<BookableResult> {
  const rules = await loadRules(admin, now);
  const from = new Date(when.getTime() - 60 * 60000).toISOString();
  const to = new Date(when.getTime() + 2 * 60 * 60000).toISOString();
  const { busy } = await loadBusy(admin, from, to);
  return checkBookable({
    when, person, windows: rules.windows, blocks: rules.blocks, busy,
    requireWindow: requireWindow && rules.configured, now,
  });
}
