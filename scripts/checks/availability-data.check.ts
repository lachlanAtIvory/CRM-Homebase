/**
 * Checks the layer that feeds the slot engine (src/lib/hq/availability-data.ts) and the settings editor
 * (src/lib/hq/availability-admin.ts): loading hours and time off, combining the shared Google Calendar
 * with the CRM's meetings, the last-second booking check, and saving hours / time off.
 *
 * Run from the repo root:  npx tsx scripts/checks/availability-data.check.ts
 */
type Row = Record<string, any>;

// ── Stand in for Google: what's "on the shared calendar" right now
const google: { events: any[] | null } = { events: null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gcPath = require.resolve("../../src/lib/hq/google-calendar");
require.cache[gcPath] = { id: gcPath, filename: gcPath, loaded: true, exports: { listCalendarEvents: async () => google.events } } as any;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const data = require("../../src/lib/hq/availability-data");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const admin = require("../../src/lib/hq/availability-admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sydneyWallToISO } = require("../../src/lib/hq/sydney-time");

function makeDb(seed: Record<string, Row[]>, missing: string[] = []) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  class Q {
    mode = "select"; payload: any; returning = false; f: ((r: Row) => boolean)[] = []; ord: [string, boolean][] = []; one = false;
    constructor(public t: string) {}
    select() { if (this.mode !== "select") this.returning = true; return this; }
    insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
    delete() { this.mode = "delete"; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    gte(c: string, v: any) { this.f.push((r) => new Date(r[c]).getTime() >= new Date(v).getTime()); return this; }
    gt(c: string, v: any) { this.f.push((r) => new Date(r[c]).getTime() > new Date(v).getTime()); return this; }
    lt(c: string, v: any) { this.f.push((r) => new Date(r[c]).getTime() < new Date(v).getTime()); return this; }
    order(c: string, o?: any) { this.ord.push([c, o?.ascending !== false]); return this; }
    single() { this.one = true; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run(): any {
      if (missing.includes(this.t)) return { data: null, error: { code: "42P01", message: `relation "public.${this.t}" does not exist` } };
      const rows = (tables[this.t] ??= []);
      if (this.mode === "insert") {
        const made = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({ id: `${this.t}-${++n}`, ...p }));
        rows.push(...made);
        return this.fin(made);
      }
      let hit = rows.filter((r) => this.f.every((g) => g(r)));
      if (this.mode === "delete") { hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return { data: null, error: null }; }
      for (const [c, asc] of [...this.ord].reverse()) hit = [...hit].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      return this.fin(hit);
    }
    fin(rs: Row[]) { const out = rs.map((r) => ({ ...r })); return this.one ? { data: out[0] ?? null, error: out.length ? null : { message: "no rows" } } : { data: out, error: null }; }
  }
  return { tables, from: (t: string) => new Q(t) } as any;
}

let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };
const at = (local: string) => new Date(sydneyWallToISO(local)!);
const NOW = at("2026-10-19T09:00");

// the hours exactly as the migration seeds them (Postgres hands back "08:00:00")
const seedWindows = [
  ...[3, 5, 6, 0].map((weekday) => ({ person: "lachlan", weekday, start_time: "08:00:00", end_time: "18:00:00" })),
  ...[1, 2, 3, 4, 5].map((weekday) => ({ person: "ryan", weekday, start_time: "08:00:00", end_time: "13:00:00" })),
  ...[6, 0].map((weekday) => ({ person: "ryan", weekday, start_time: "08:00:00", end_time: "18:00:00" })),
];
const slotTimes = (res: any, date: string, who?: string) => (res.days.find((d: any) => d.date === date)?.slots ?? []).filter((s: any) => !who || s.free.includes(who)).map((s: any) => s.time);

(async () => {
  // ── loading the rules
  let db = makeDb({ availability_windows: seedWindows });
  let rules = await data.loadRules(db, NOW);
  eq("rules: 11 windows, times trimmed to HH:MM", [rules.windows.length, rules.windows[0]], [11, { person: "lachlan", weekday: 3, start: "08:00", end: "18:00" }]);
  eq("rules: configured", [rules.configured, rules.setupNeeded], [true, false]);
  rules = await data.loadRules(makeDb({}, ["availability_windows"]), NOW);
  eq("rules: before the migration -> setupNeeded, not configured, no crash", [rules.configured, rules.setupNeeded, rules.windows.length], [false, true, 0]);
  rules = await data.loadRules(makeDb({ availability_windows: [] }), NOW);
  eq("rules: no hours set -> not configured (booking falls back to free pick)", [rules.configured, rules.setupNeeded], [false, false]);
  db = makeDb({ availability_windows: seedWindows, availability_blocks: [
    { person: "ryan", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-02T00:00:00Z" },        // already over
    { person: "ryan", starts_at: "2026-10-22T00:00:00Z", ends_at: "2026-10-24T00:00:00Z" } ] });
  rules = await data.loadRules(db, NOW);
  eq("rules: time off that has already ended is ignored", rules.blocks.length, 1);

  // ── slots from the CRM's meetings table alone (Google unreachable)
  google.events = null;
  db = makeDb({ availability_windows: seedWindows, meetings: [
    { event_id: "m1", title: "Sales call — Red Earth Physio · Aaron → Lachlan", start_time: at("2026-10-21T14:00").toISOString(), end_time: at("2026-10-21T14:30").toISOString() } ] });
  let res = await data.getSlots(db, 14, NOW);
  eq("Google down: falls back to the CRM's meetings and says so", res.source, "crm-only");
  eq("Wed 2:00 pm is gone (Lachlan already has a call)", slotTimes(res, "2026-10-21").includes("2:00 pm"), false);
  eq("Wed 1:30 and 2:30 still there", [slotTimes(res, "2026-10-21").includes("1:30 pm"), slotTimes(res, "2026-10-21").includes("2:30 pm")], [true, true]);
  eq("result shape", [res.configured, res.horizonDays, res.days.length], [true, 14, 14]);

  // ── slots from the shared Google Calendar (anything anyone adds there counts)
  google.events = [
    { id: "g1", title: "Neutral Bay onboarding", start: at("2026-10-21T10:00").toISOString(), end: at("2026-10-21T11:00").toISOString(), allDay: false },
    { id: "m1", title: "Sales call — Red Earth Physio · Aaron → Lachlan", start: at("2026-10-21T14:00").toISOString(), end: at("2026-10-21T14:30").toISOString(), allDay: false },   // same event as the CRM row
    { id: "g3", title: "Ryan on leave", start: "2026-10-22", end: "2026-10-23", allDay: true },
  ];
  res = await data.getSlots(db, 14, NOW);
  eq("Google up: source is the calendar", res.source, "calendar");
  eq("an event added straight into Google (no name) blocks BOTH people 10:00-11:00 Wednesday", ["9:30 am", "10:00 am", "10:30 am", "11:00 am"].map((t) => slotTimes(res, "2026-10-21").includes(t)), [true, false, false, true]);
  eq("the same booking in Google and the CRM isn't counted twice (still just 2:00 pm gone)", [slotTimes(res, "2026-10-21").includes("1:30 pm"), slotTimes(res, "2026-10-21").includes("2:00 pm"), slotTimes(res, "2026-10-21").includes("2:30 pm")], [true, false, true]);
  eq("an all-day 'Ryan on leave' empties Thursday", res.days.some((d: any) => d.date === "2026-10-22"), false);
  google.events = [];
  res = await data.getSlots(db, 14, NOW);
  eq("Google reachable but empty: still 'calendar', CRM booking still counts", [res.source, slotTimes(res, "2026-10-21").includes("2:00 pm")], ["calendar", false]);

  // horizon limits
  eq("days is clamped to 42", (await data.getSlots(db, 999, NOW)).horizonDays, 42);
  eq("days defaults to 14 when junk", (await data.getSlots(db, NaN as any, NOW)).horizonDays, 14);
  const none = await data.getSlots(makeDb({ availability_windows: [] }), 14, NOW);
  eq("no hours set: configured=false and no slots", [none.configured, none.days.length], [false, 0]);

  // ── the last-second booking check
  google.events = null;
  db = makeDb({ availability_windows: seedWindows, meetings: [{ event_id: "m1", title: "Sales call — Q · Aaron → Lachlan", start_time: at("2026-10-21T14:00").toISOString(), end_time: at("2026-10-21T14:30").toISOString() }] });
  const chk = (when: string, person: string, rw: boolean) => data.checkSlotBookable(db, at(when), person, rw, NOW);
  eq("free slot inside hours", (await chk("2026-10-21T10:00", "lachlan", true)).ok, true);
  eq("taken slot refused", (await chk("2026-10-21T14:00", "lachlan", true)).ok, false);
  eq("Ryan on Wednesday afternoon is outside his hours", (await chk("2026-10-21T14:00", "ryan", true)).ok, false);
  eq("...but a manager's free-typed time only gets the conflict check", (await chk("2026-10-21T14:30", "ryan", false)).ok, true);
  db = makeDb({ availability_windows: [], meetings: [] });
  eq("no hours set up: requireWindow is ignored so booking still works", (await data.checkSlotBookable(db, at("2026-10-23T03:00"), "ryan", true, NOW)).ok, true);

  // ── the editor
  db = makeDb({ availability_windows: seedWindows });
  let ed = await admin.loadEditorData(db, NOW);
  eq("editor: 7 days each, Ryan Monday on 08:00-13:00, Ryan's Sunday on", [ed.hours.ryan.length, ed.hours.ryan[1], ed.hours.ryan[0].enabled], [7, { weekday: 1, enabled: true, start: "08:00", end: "13:00" }, true]);
  eq("editor: Lachlan's Monday is off (a blank day)", ed.hours.lachlan[1], { weekday: 1, enabled: false, start: "08:00", end: "17:00" });
  ed = await admin.loadEditorData(makeDb({}, ["availability_windows"]), NOW);
  eq("editor: before the migration -> setupNeeded", ed.setupNeeded, true);

  const days = (spec: Record<number, [string, string]>) => Array.from({ length: 7 }, (_, weekday) => spec[weekday] ? { weekday, enabled: true, start: spec[weekday][0], end: spec[weekday][1] } : { weekday, enabled: false, start: "08:00", end: "17:00" });
  let sv = await admin.saveHours(db, "ryan", days({ 1: ["09:00", "12:00"], 2: ["09:00", "12:00"] }));
  eq("saveHours replaces Ryan's week", [sv.ok, db.tables.availability_windows.filter((w: Row) => w.person === "ryan").map((w: Row) => `${w.weekday}:${w.start_time}-${w.end_time}`).sort()], [true, ["1:09:00-12:00", "2:09:00-12:00"]]);
  eq("...and leaves Lachlan's untouched", db.tables.availability_windows.filter((w: Row) => w.person === "lachlan").length, 4);
  sv = await admin.saveHours(db, "ryan", days({}));
  eq("all days off is allowed (person unavailable)", [sv.ok, db.tables.availability_windows.filter((w: Row) => w.person === "ryan").length], [true, 0]);
  for (const [name, input] of [
    ["bad person", ["bob", days({})]], ["not a list", ["ryan", "nope"]],
    ["end before start", ["ryan", days({ 1: ["13:00", "09:00"] })]], ["zero length", ["ryan", days({ 1: ["09:00", "09:00"] })]],
    ["under 30 minutes", ["ryan", days({ 1: ["09:00", "09:20"] })]], ["bad time text", ["ryan", days({ 1: ["9am", "5pm"] })]],
    ["duplicate day", ["ryan", [{ weekday: 1, enabled: true, start: "08:00", end: "12:00" }, { weekday: 1, enabled: true, start: "13:00", end: "17:00" }]]],
    ["weekday 7", ["ryan", [{ weekday: 7, enabled: true, start: "08:00", end: "12:00" }]]],
  ] as [string, [unknown, unknown]][]) {
    const before = JSON.stringify(db.tables.availability_windows);
    const r = await admin.saveHours(db, input[0], input[1]);
    eq(`saveHours rejects: ${name} (and changes nothing)`, [r.ok, r.status, JSON.stringify(db.tables.availability_windows) === before], [false, 400, true]);
  }

  // time off
  const A = "lachlan@agentivory.com";
  let bl = await admin.addBlock(db, A, { person: "lachlan", from: "2026-10-24", to: "2026-10-25", allDay: true, reason: "  Weekend away " });
  eq("all-day block covers whole SYDNEY days (24th + 25th Oct = 13:00Z to 13:00Z, daylight saving)", [bl.ok, bl.block.starts_at, bl.block.ends_at, bl.block.reason, bl.block.created_by], [true, "2026-10-23T13:00:00.000Z", "2026-10-25T13:00:00.000Z", "Weekend away", A]);
  bl = await admin.addBlock(db, A, { person: "ryan", from: "2026-10-21", allDay: true });
  eq("a single all-day block (no 'to') is one day", [bl.block.starts_at, bl.block.ends_at], ["2026-10-20T13:00:00.000Z", "2026-10-21T13:00:00.000Z"]);
  bl = await admin.addBlock(db, A, { person: "ryan", from: "2026-10-21", allDay: false, fromTime: "09:00", toTime: "10:30" });
  eq("a timed block is in Sydney time (9:00-10:30 AEDT)", [bl.block.starts_at, bl.block.ends_at], ["2026-10-20T22:00:00.000Z", "2026-10-20T23:30:00.000Z"]);
  for (const [name, input] of [
    ["bad person", { person: "x", from: "2026-10-21" }], ["no date", { person: "ryan" }], ["bad date", { person: "ryan", from: "tomorrow" }],
    ["last day before first", { person: "ryan", from: "2026-10-25", to: "2026-10-21" }], ["over a year", { person: "ryan", from: "2026-10-21", to: "2028-10-21" }],
    ["timed: end before start", { person: "ryan", from: "2026-10-21", allDay: false, fromTime: "12:00", toTime: "09:00" }], ["timed: bad time", { person: "ryan", from: "2026-10-21", allDay: false, fromTime: "noon", toTime: "1pm" }],
  ] as [string, any][]) { const r = await admin.addBlock(db, A, input); eq(`addBlock rejects: ${name}`, [r.ok, r.status], [false, 400]); }
  ed = await admin.loadEditorData(db, NOW);
  eq("editor lists upcoming time off in date order", ed.blocks.map((b: any) => b.person + ":" + b.starts_at.slice(0, 10)), ["ryan:2026-10-20", "ryan:2026-10-20", "lachlan:2026-10-23"]);
  const rm = await admin.removeBlock(db, ed.blocks[0].id);
  eq("removeBlock", [rm.ok, db.tables.availability_blocks.length], [true, 2]);
  const noTable = await admin.addBlock(makeDb({}, ["availability_blocks"]), A, { person: "ryan", from: "2026-10-21" });
  eq("addBlock before the migration -> 503 with a plain message", [noTable.ok, noTable.status, /migration/.test(noTable.error)], [false, 503, true]);

  // time off really hides slots end to end
  db = makeDb({ availability_windows: seedWindows, availability_blocks: [] });
  await admin.addBlock(db, A, { person: "lachlan", from: "2026-10-24", to: "2026-10-25", allDay: true });
  res = await data.getSlots(db, 14, NOW);
  eq("end to end: Lachlan off all weekend -> weekend slots are Ryan-only", res.days.find((d: any) => d.date === "2026-10-24").slots.every((s: any) => s.free.length === 1 && s.free[0] === "ryan"), true);

  console.log(`\n${passes} passed, ${fails} failed`);
})();

export {};
