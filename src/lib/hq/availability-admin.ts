import type { SupabaseClient } from "@supabase/supabase-js";
import { PEOPLE, type Person } from "./availability";
import { isMissingAccessSetup } from "./access";
import { addDaysToDate, startOfSydneyDate, sydneyWallToISO } from "./sydney-time";

/**
 * Settings > Call availability: weekly hours and time off. Takes the
 * service-role client; routes call it only after confirming a manager.
 */

export type DayHours = { weekday: number; enabled: boolean; start: string; end: string };
export type EditorBlock = { id: string; person: Person; starts_at: string; ends_at: string; reason: string | null; created_by: string | null };
export type EditorData = {
  /** Per person: 7 entries, Sunday (0) to Saturday (6). */
  hours: Record<Person, DayHours[]>;
  blocks: EditorBlock[];
  setupNeeded: boolean;
};

type Failure = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Failure => ({ ok: false, status, error });

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isPerson = (p: unknown): p is Person => PEOPLE.includes(p as Person);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const blank = (): DayHours[] => Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: false, start: "08:00", end: "17:00" }));

export async function loadEditorData(admin: SupabaseClient, now = new Date()): Promise<EditorData> {
  const hours: Record<Person, DayHours[]> = { ryan: blank(), lachlan: blank() };
  const w = await admin.from("availability_windows").select("person, weekday, start_time, end_time");
  if (w.error) return { hours, blocks: [], setupNeeded: isMissingAccessSetup(w.error) };
  for (const r of w.data ?? []) {
    if (!isPerson(r.person)) continue;
    hours[r.person][Number(r.weekday)] = {
      weekday: Number(r.weekday), enabled: true,
      start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5),
    };
  }
  const b = await admin
    .from("availability_blocks")
    .select("id, person, starts_at, ends_at, reason, created_by")
    .gte("ends_at", now.toISOString())
    .order("starts_at", { ascending: true });
  return { hours, blocks: (b.data ?? []) as EditorBlock[], setupNeeded: false };
}

/** Replace one person's weekly hours. */
export async function saveHours(
  admin: SupabaseClient, person: unknown, days: unknown,
): Promise<{ ok: true } | Failure> {
  if (!isPerson(person)) return fail(400, "Choose Ryan or Lachlan.");
  if (!Array.isArray(days)) return fail(400, "Send the days as a list.");

  const rows: { person: Person; weekday: number; start_time: string; end_time: string }[] = [];
  const seen = new Set<number>();
  for (const d of days as Partial<DayHours>[]) {
    const weekday = Number(d.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) return fail(400, "Each day can only appear once.");
    seen.add(weekday);
    if (!d.enabled) continue;
    const start = String(d.start ?? ""), end = String(d.end ?? "");
    if (!TIME.test(start) || !TIME.test(end)) return fail(400, "Times must look like 08:00.");
    if (minutes(end) <= minutes(start)) return fail(400, "A day has to end after it starts.");
    if (minutes(end) - minutes(start) < 30) return fail(400, "A day needs at least 30 minutes to fit a call.");
    rows.push({ person, weekday, start_time: start, end_time: end });
  }

  const del = await admin.from("availability_windows").delete().eq("person", person);
  if (del.error) return fail(isMissingAccessSetup(del.error) ? 503 : 500, isMissingAccessSetup(del.error) ? "Run the availability migration in Supabase first." : del.error.message);
  if (rows.length) {
    const ins = await admin.from("availability_windows").insert(rows);
    if (ins.error) return fail(500, ins.error.message);
  }
  return { ok: true };
}

/** Add time off. All-day covers whole Sydney days (from..to inclusive); otherwise a time range on one day. */
export async function addBlock(
  admin: SupabaseClient, actorEmail: string,
  input: { person?: unknown; from?: unknown; to?: unknown; allDay?: unknown; fromTime?: unknown; toTime?: unknown; reason?: unknown },
): Promise<{ ok: true; block: EditorBlock } | Failure> {
  if (!isPerson(input.person)) return fail(400, "Choose Ryan or Lachlan.");
  const from = String(input.from ?? "");
  if (!DATE.test(from)) return fail(400, "Choose a date.");
  const reason = String(input.reason ?? "").trim().slice(0, 120) || null;

  let startsAt: string | null, endsAt: string | null;
  if (input.allDay !== false) {
    const to = DATE.test(String(input.to ?? "")) ? String(input.to) : from;
    if (to < from) return fail(400, "The last day can't be before the first.");
    if (to > addDaysToDate(from, 365)) return fail(400, "Time off can be at most a year long.");
    startsAt = startOfSydneyDate(from);
    endsAt = startOfSydneyDate(addDaysToDate(to, 1));
  } else {
    const ft = String(input.fromTime ?? ""), tt = String(input.toTime ?? "");
    if (!TIME.test(ft) || !TIME.test(tt)) return fail(400, "Times must look like 08:00.");
    if (minutes(tt) <= minutes(ft)) return fail(400, "The end time must be after the start time.");
    startsAt = sydneyWallToISO(`${from}T${ft}`);
    endsAt = sydneyWallToISO(`${from}T${tt}`);
  }
  if (!startsAt || !endsAt) return fail(400, "That date doesn't look right.");

  const { data, error } = await admin
    .from("availability_blocks")
    .insert({ person: input.person, starts_at: startsAt, ends_at: endsAt, reason, created_by: actorEmail })
    .select("id, person, starts_at, ends_at, reason, created_by")
    .single();
  if (error) return fail(isMissingAccessSetup(error) ? 503 : 500, isMissingAccessSetup(error) ? "Run the availability migration in Supabase first." : error.message);
  return { ok: true, block: data as EditorBlock };
}

export async function removeBlock(admin: SupabaseClient, id: string): Promise<{ ok: true } | Failure> {
  const { error } = await admin.from("availability_blocks").delete().eq("id", id);
  if (error) return fail(500, error.message);
  return { ok: true };
}
