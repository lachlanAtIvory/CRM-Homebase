/**
 * Call availability — the rules for which sales-call times can be offered.
 *
 * Pure functions only (no database, no network) so every rule can be tested.
 * A 30-minute time is free for a person when ALL of these hold:
 *   1. it sits inside that person's weekly window for that day (Sydney time)
 *   2. it is at least MIN_NOTICE_MINUTES from now
 *   3. they haven't blocked it out (time off)
 *   4. nothing on the shared Ivory calendar overlaps it for them
 *
 * What counts as "on the calendar for them" is decided from the event title,
 * see attributePersons.
 */

import {
  addDaysToDate, formatDateLabel, formatSydneyClock, startOfSydneyDate,
  sydneyDateOf, sydneyWallToISO, weekdayOfDate,
} from "./sydney-time";

export type Person = "ryan" | "lachlan";
export const PEOPLE: Person[] = ["ryan", "lachlan"];
export const PERSON_LABEL: Record<Person, string> = { ryan: "Ryan", lachlan: "Lachlan" };

export const SLOT_MINUTES = 30;
export const MIN_NOTICE_MINUTES = 60;
export const DEFAULT_HORIZON_DAYS = 14;
export const MAX_HORIZON_DAYS = 42;

/** A weekly window: weekday 0 = Sunday ... 6 = Saturday, times "HH:MM" in Sydney. */
export type Window = { person: Person; weekday: number; start: string; end: string };

/** One-off unavailable period. */
export type Block = { person: Person; starts_at: string; ends_at: string };

/** Something already on the calendar, with who it ties up. */
export type Busy = { start: number; end: number; persons: Person[] };

export type Slot = {
  /** ISO instant the call starts. */
  start: string;
  /** "9:30 am" in Sydney time. */
  time: string;
  /** Everyone free at this time. */
  free: Person[];
  /** Who to give the call to when the caller doesn't choose. */
  suggested: Person;
};

export type DaySlots = {
  date: string;       // "2026-10-20"
  label: string;      // "Tue 20 Oct"
  relative: string | null;   // "Today" / "Tomorrow"
  slots: Slot[];
};

/* ── Who an event ties up ────────────────────────────────────────────────── */

/**
 * Work out who a shared-calendar event belongs to from its title.
 *
 *   "Sales call — Breeze Dental · Aaron → Ryan"   → Ryan   (booked for him)
 *   "Sales call — Breeze Dental · Lachlan"        → Lachlan (he booked it himself)
 *   "Callback — Smith (0412…) · Ryan"             → Ryan
 *   "Ryan on leave"                               → Ryan
 *   "Team meeting" / anything unclear             → both (never risk a double booking)
 *
 * The explicit "→ Name" and "· Name" markers win over a name that merely
 * appears in the business name ("Ryan's Dental").
 */
export function attributePersons(title: string): Person[] {
  const t = (title ?? "").trim();
  const arrow = /→\s*(ryan or lachlan|lachlan or ryan|ryan|lachlan)\s*$/i.exec(t);
  if (arrow) {
    const who = arrow[1].toLowerCase();
    return who === "ryan" ? ["ryan"] : who === "lachlan" ? ["lachlan"] : [...PEOPLE];
  }
  const by = /·\s*(ryan|lachlan)\s*$/i.exec(t);
  if (by) return [by[1].toLowerCase() as Person];

  const ryan = /\bryan\b/i.test(t);
  const lachlan = /\blachlan\b/i.test(t);
  if (ryan && !lachlan) return ["ryan"];
  if (lachlan && !ryan) return ["lachlan"];
  return [...PEOPLE];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

function isFreeAt(
  person: Person, startMs: number, endMs: number, blocks: Block[], busy: Busy[],
): boolean {
  for (const b of blocks) {
    if (b.person === person && overlaps(startMs, endMs, new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime())) return false;
  }
  for (const e of busy) {
    if (e.persons.includes(person) && overlaps(startMs, endMs, e.start, e.end)) return false;
  }
  return true;
}

/** Turn "08:00" into minutes since midnight. */
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * When both people can take a call, pick whoever has fewer calls that day,
 * then fewer calls overall, then Ryan. (The caller can always filter to one person.)
 */
export function suggestPerson(
  free: Person[],
  dayLoad: Record<Person, number>,
  totalLoad: Record<Person, number>,
): Person {
  if (free.length === 1) return free[0];
  return [...free].sort(
    (a, b) => dayLoad[a] - dayLoad[b] || totalLoad[a] - totalLoad[b] || PEOPLE.indexOf(a) - PEOPLE.indexOf(b),
  )[0];
}

/** Calls already booked for a person on a Sydney date (only events clearly theirs, not "both"). */
function loadOn(date: string | null, busy: Busy[]): Record<Person, number> {
  const out: Record<Person, number> = { ryan: 0, lachlan: 0 };
  for (const e of busy) {
    if (e.persons.length !== 1) continue;
    if (date && sydneyDateOf(new Date(e.start)) !== date) continue;
    out[e.persons[0]]++;
  }
  return out;
}

/* ── The slot list ───────────────────────────────────────────────────────── */

export type SlotInput = {
  now: Date;
  windows: Window[];
  blocks: Block[];
  busy: Busy[];
  days?: number;
  slotMinutes?: number;
  minNoticeMinutes?: number;
};

/** Every bookable time over the next few days, grouped by Sydney date. Days with nothing free are left out. */
export function computeSlots(input: SlotInput): DaySlots[] {
  const {
    now, windows, blocks, busy,
    days = DEFAULT_HORIZON_DAYS,
    slotMinutes = SLOT_MINUTES,
    minNoticeMinutes = MIN_NOTICE_MINUTES,
  } = input;
  const earliest = now.getTime() + minNoticeMinutes * 60000;
  const today = sydneyDateOf(now);
  const totalLoad = loadOn(null, busy);
  const out: DaySlots[] = [];

  for (let i = 0; i < Math.min(days, MAX_HORIZON_DAYS); i++) {
    const date = addDaysToDate(today, i);
    const weekday = weekdayOfDate(date);
    const dayLoad = loadOn(date, busy);
    const byStart = new Map<string, Slot>();

    for (const person of PEOPLE) {
      const w = windows.find((x) => x.person === person && x.weekday === weekday);
      if (!w) continue;
      for (let m = toMinutes(w.start); m + slotMinutes <= toMinutes(w.end); m += slotMinutes) {
        const startIso = sydneyWallToISO(`${date}T${toHHMM(m)}`);
        if (!startIso) continue;
        const startMs = new Date(startIso).getTime();
        if (startMs < earliest) continue;
        if (!isFreeAt(person, startMs, startMs + slotMinutes * 60000, blocks, busy)) continue;
        const slot = byStart.get(startIso) ?? { start: startIso, time: formatSydneyClock(startIso), free: [], suggested: person };
        slot.free.push(person);
        byStart.set(startIso, slot);
      }
    }

    const slots = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
    for (const s of slots) s.suggested = suggestPerson(s.free, dayLoad, totalLoad);
    if (slots.length) {
      out.push({ date, label: formatDateLabel(date), relative: i === 0 ? "Today" : i === 1 ? "Tomorrow" : null, slots });
    }
  }
  return out;
}

/* ── Checking one time before booking it ─────────────────────────────────── */

export type BookableResult = { ok: true } | { ok: false; reason: string };

/**
 * Is this exact time still free for this person? Run on the server at the
 * moment of booking, so two people can't take the same slot.
 *
 *   requireWindow  also insist it sits inside the person's weekly window
 *                  (true for times picked from the offered slots).
 *   person "either" means a call for whoever is free: ok if at least one is.
 */
export function checkBookable(input: {
  when: Date;
  person: Person | "either";
  windows: Window[];
  blocks: Block[];
  busy: Busy[];
  requireWindow: boolean;
  now?: Date;
  slotMinutes?: number;
}): BookableResult {
  const { when, person, windows, blocks, busy, requireWindow, slotMinutes = SLOT_MINUTES } = input;
  const now = input.now ?? new Date();
  const startMs = when.getTime();
  const endMs = startMs + slotMinutes * 60000;
  if (startMs <= now.getTime()) return { ok: false, reason: "That time has already passed. Pick another." };

  const date = sydneyDateOf(when);
  const weekday = weekdayOfDate(date);
  const candidates = person === "either" ? PEOPLE : [person];

  const free = candidates.filter((p) => {
    if (requireWindow) {
      const w = windows.find((x) => x.person === p && x.weekday === weekday);
      if (!w) return false;
      const startMin = toMinutes(sydneyClockHHMM(when));
      if (startMin < toMinutes(w.start) || startMin + slotMinutes > toMinutes(w.end)) return false;
    }
    return isFreeAt(p, startMs, endMs, blocks, busy);
  });

  if (free.length) return { ok: true };
  const name = person === "either" ? "Ryan and Lachlan are both" : `${PERSON_LABEL[person]} is`;
  return { ok: false, reason: `${name} not free then, or it was just taken. Pick another time.` };
}

/** "14:30" Sydney wall clock of an instant. */
function sydneyClockHHMM(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Sydney", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/* ── Turning raw events into Busy ────────────────────────────────────────── */

export type RawEvent = {
  title: string;
  /** ISO instant, or a plain date ("2026-10-20") for an all-day event. */
  start: string;
  end: string;
  allDay?: boolean;
};

/** Convert calendar events to busy intervals. An all-day event ties up the whole Sydney day(s). */
export function toBusy(events: RawEvent[]): Busy[] {
  const out: Busy[] = [];
  for (const e of events) {
    let start: number, end: number;
    if (e.allDay) {
      start = new Date(startOfSydneyDate(e.start.slice(0, 10))).getTime();
      end = new Date(startOfSydneyDate(e.end.slice(0, 10))).getTime();
    } else {
      start = new Date(e.start).getTime();
      end = new Date(e.end).getTime();
    }
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    out.push({ start, end, persons: attributePersons(e.title) });
  }
  return out;
}
