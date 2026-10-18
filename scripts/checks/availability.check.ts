/**
 * Checks the slot engine (src/lib/hq/availability.ts) with the real hours: Lachlan free all day
 * Wed/Fri/weekends, Ryan free 8-1 on weekdays and all day on weekends. Covers what gets offered,
 * what disappears when something is booked, who an event belongs to, and the last-second re-check.
 *
 * Run from the repo root:  npx tsx scripts/checks/availability.check.ts
 */
import { attributePersons, computeSlots, checkBookable, toBusy, suggestPerson, type Window, type Block } from "../../src/lib/hq/availability";
import { sydneyWallToISO } from "../../src/lib/hq/sydney-time";

let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

const W: Window[] = [
  ...[3, 5, 6, 0].map((weekday) => ({ person: "lachlan" as const, weekday, start: "08:00", end: "18:00" })),
  ...[1, 2, 3, 4, 5].map((weekday) => ({ person: "ryan" as const, weekday, start: "08:00", end: "13:00" })),
  ...[6, 0].map((weekday) => ({ person: "ryan" as const, weekday, start: "08:00", end: "18:00" })),
];
const at = (local: string) => new Date(sydneyWallToISO(local)!);
const NOW = at("2026-10-19T09:00");                       // Monday 19 Oct 2026, 9:00 am Sydney
type Days = ReturnType<typeof computeSlots>;
const day = (days: Days, date: string) => days.find((d) => d.date === date);
const times = (d: Days[number] | undefined, who?: string) => (d?.slots ?? []).filter((s) => !who || s.free.includes(who as never)).map((s) => s.time);
const ev = (title: string, start: string, end: string) => ({ title, start: at(start).toISOString(), end: at(end).toISOString() });
const slots = (busy: ReturnType<typeof toBusy> = [], blocks: Block[] = [], now = NOW, days?: number) => computeSlots({ now, windows: W, blocks, busy, days });

// ── Nothing booked: your hours
let d = slots();
eq("Mon: Ryan only, from 10:00 (1 hour notice) to 12:30", [times(day(d, "2026-10-19"), "ryan")[0], times(day(d, "2026-10-19"), "ryan").at(-1), times(day(d, "2026-10-19"), "lachlan")], ["10:00 am", "12:30 pm", []]);
eq("Mon has 6 slots", times(day(d, "2026-10-19")).length, 6);
eq("Tue: Ryan only, 8:00 am to 12:30 pm (10 slots)", [times(day(d, "2026-10-20"))[0], times(day(d, "2026-10-20")).length], ["8:00 am", 10]);
const wed = day(d, "2026-10-21")!;
eq("Wed runs 8:00 am to 5:30 pm (20 slots)", [wed.slots[0].time, wed.slots.at(-1)!.time, wed.slots.length], ["8:00 am", "5:30 pm", 20]);
eq("Wed 9:00 both free; 2:00 pm only Lachlan", [wed.slots.find((s) => s.time === "9:00 am")!.free, wed.slots.find((s) => s.time === "2:00 pm")!.free], [["ryan", "lachlan"], ["lachlan"]]);
eq("Thu: only Ryan mornings", [times(day(d, "2026-10-22"), "lachlan"), times(day(d, "2026-10-22"), "ryan").length], [[], 10]);
eq("Fri afternoons are Lachlan's", day(d, "2026-10-23")!.slots.find((s) => s.time === "3:00 pm")!.free, ["lachlan"]);
eq("Sat and Sun: both, all day", [day(d, "2026-10-24")!.slots.length, day(d, "2026-10-24")!.slots[0].free, day(d, "2026-10-25")!.slots.length], [20, ["ryan", "lachlan"], 20]);
eq("14 days listed by default", d.length, 14);
eq("labels", [d[0].relative, d[1].relative, d[2].relative, d[0].label], ["Today", "Tomorrow", null, "Mon 19 Oct"]);
eq("slot start is the real instant (Wed 8am AEDT = 21:00Z the day before)", wed.slots[0].start, "2026-10-20T21:00:00.000Z");
eq("the `days` option", slots([], [], NOW, 3).length, 3);

// ── YOUR EXAMPLE: Lachlan already has a call at 2pm on Wednesday
d = slots(toBusy([ev("Sales call — Red Earth Physio · Aaron → Lachlan", "2026-10-21T14:00", "2026-10-21T14:30")]));
let w = day(d, "2026-10-21")!;
eq("Wed 2:00 pm is GONE completely (Ryan isn't free then either)", w.slots.some((s) => s.time === "2:00 pm"), false);
eq("1:30 and 2:30 are still offered", [w.slots.some((s) => s.time === "1:30 pm"), w.slots.some((s) => s.time === "2:30 pm")], [true, true]);
eq("only that one slot lost", w.slots.length, 19);

// A call booked for Ryan at 9:00 leaves Lachlan free at 9:00
d = slots(toBusy([ev("Sales call — X · Aaron → Ryan", "2026-10-21T09:00", "2026-10-21T09:30")]));
eq("Wed 9:00 still offered, but only for Lachlan", day(d, "2026-10-21")!.slots.find((s) => s.time === "9:00 am")!.free, ["lachlan"]);

// Overlaps
d = slots(toBusy([ev("Sales call — Y · Lachlan", "2026-10-21T13:45", "2026-10-21T14:30")]));
eq("45-minute event 1:45-2:30 removes the 1:30 and 2:00 starts only", ["1:00 pm", "1:30 pm", "2:00 pm", "2:30 pm"].map((t) => day(d, "2026-10-21")!.slots.some((s) => s.time === t)), [true, false, false, true]);
d = slots(toBusy([ev("Callback — Z (0412) · Lachlan", "2026-10-21T14:00", "2026-10-21T14:15")]));
eq("a 15-minute callback removes just that 2:00 slot", ["1:30 pm", "2:00 pm", "2:30 pm"].map((t) => day(d, "2026-10-21")!.slots.some((s) => s.time === t)), [true, false, true]);

// Events with nobody's name tie up both
d = slots(toBusy([ev("Team meeting", "2026-10-21T09:00", "2026-10-21T10:00")]));
eq("an unnamed event blocks both: 9:00 and 9:30 gone, 10:00 back", ["9:00 am", "9:30 am", "10:00 am"].map((t) => day(d, "2026-10-21")!.slots.some((s) => s.time === t)), [false, false, true]);

// All-day events
d = slots(toBusy([{ title: "Ryan on leave", start: "2026-10-22", end: "2026-10-23", allDay: true }]));
eq("all-day 'Ryan on leave' empties Thursday (only Ryan works Thursdays)", day(d, "2026-10-22"), undefined);
eq("...and leaves Wednesday alone", day(d, "2026-10-21")!.slots.length, 20);

// Time off
const blocks: Block[] = [{ person: "lachlan", starts_at: at("2026-10-24T00:00").toISOString(), ends_at: at("2026-10-25T00:00").toISOString() }];
d = slots([], blocks);
eq("Lachlan off all Saturday: Saturday is Ryan only", day(d, "2026-10-24")!.slots.every((s) => s.free.length === 1 && s.free[0] === "ryan"), true);

// Notice and edges
eq("1 hour notice: now 11:30 -> only 12:30 left on Monday", times(day(slots([], [], at("2026-10-19T11:30")), "2026-10-19")), ["12:30 pm"]);
eq("after the window closes, nothing today", day(slots([], [], at("2026-10-19T12:15")), "2026-10-19"), undefined);

// Who gets a call when both are free
eq("equal load -> Ryan", suggestPerson(["ryan", "lachlan"], { ryan: 0, lachlan: 0 }, { ryan: 0, lachlan: 0 }), "ryan");
eq("Ryan has 2 that day -> Lachlan", suggestPerson(["ryan", "lachlan"], { ryan: 2, lachlan: 0 }, { ryan: 2, lachlan: 0 }), "lachlan");
eq("equal that day, Lachlan fewer overall -> Lachlan", suggestPerson(["ryan", "lachlan"], { ryan: 1, lachlan: 1 }, { ryan: 5, lachlan: 3 }), "lachlan");
eq("only one free -> that one", suggestPerson(["lachlan"], { ryan: 0, lachlan: 9 }, { ryan: 0, lachlan: 9 }), "lachlan");
d = slots(toBusy([ev("Sales call — A · Aaron → Ryan", "2026-10-21T08:00", "2026-10-21T08:30")]));
eq("a day where Ryan is already booked leans to Lachlan", day(d, "2026-10-21")!.slots.find((s) => s.time === "10:00 am")!.suggested, "lachlan");

// Who is an event about
const a = attributePersons;
eq("→ Ryan", a("Sales call — Breeze · Aaron → Ryan"), ["ryan"]);
eq("→ Lachlan", a("Sales call — Breeze · Aaron → Lachlan"), ["lachlan"]);
eq("→ either", a("Sales call — Breeze · Aaron → Ryan or Lachlan"), ["ryan", "lachlan"]);
eq("booked by Ryan himself", a("Sales call — Breeze · Ryan"), ["ryan"]);
eq("callback by Lachlan", a("Callback — Smith (0412 345 678) · Lachlan"), ["lachlan"]);
eq("business called Ryan's Dental, call is Lachlan's", a("Sales call — Ryan's Dental · Aaron → Lachlan"), ["lachlan"]);
eq("plain name", a("Ryan dentist appointment"), ["ryan"]);
eq("no name -> both", a("Neutral Bay onboarding"), ["ryan", "lachlan"]);
eq("both names -> both", a("Ryan and Lachlan catch-up"), ["ryan", "lachlan"]);
eq("empty -> both", a(""), ["ryan", "lachlan"]);

// The re-check at the moment of booking
const busy = toBusy([ev("Sales call — Q · Aaron → Lachlan", "2026-10-21T14:00", "2026-10-21T14:30")]);
const chk = (when: string, person: "ryan" | "lachlan" | "either", requireWindow = true) => checkBookable({ when: at(when), person, windows: W, blocks: [], busy, requireWindow, now: NOW });
eq("free slot inside the window", chk("2026-10-21T10:00", "lachlan"), { ok: true });
eq("taken slot refused, naming the person", [chk("2026-10-21T14:00", "lachlan").ok, (chk("2026-10-21T14:00", "lachlan") as { reason: string }).reason.startsWith("Lachlan is not free")], [false, true]);
eq("Ryan 2pm Wed is outside his hours", chk("2026-10-21T14:00", "ryan").ok, false);
eq("...but allowed on the manual path (conflict check only)", chk("2026-10-21T14:00", "ryan", false), { ok: true });
eq("Lachlan on a Thursday is outside his hours", chk("2026-10-22T10:00", "lachlan").ok, false);
eq("window edge: Ryan 12:30 ok, 1:00 not", [chk("2026-10-21T12:30", "ryan").ok, chk("2026-10-21T13:00", "ryan").ok], [true, false]);
eq("either: someone free", chk("2026-10-21T14:30", "either"), { ok: true });
eq("either on manual path, both busy -> refused", checkBookable({ when: at("2026-10-21T09:00"), person: "either", windows: W, blocks: [], busy: toBusy([ev("Team meeting", "2026-10-21T09:00", "2026-10-21T09:30")]), requireWindow: false, now: NOW }).ok, false);
eq("a time already passed is refused", chk("2026-10-19T08:00", "ryan").ok, false);
eq("right after the booked call is fine", chk("2026-10-21T14:30", "lachlan"), { ok: true });
eq("right before it is fine (ends exactly at 2:00)", chk("2026-10-21T13:30", "lachlan"), { ok: true });
eq("time off is respected at booking time", checkBookable({ when: at("2026-10-24T10:00"), person: "lachlan", windows: W, blocks, busy: [], requireWindow: true, now: NOW }).ok, false);

console.log(`\n${passes} passed, ${fails} failed`);
