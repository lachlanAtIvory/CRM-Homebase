/**
 * Checks what happens when the caller logs a note or call outcome (src/lib/hq/call-lead-outcome.ts)
 * against an in-memory database: status changes, booking (client, deal, calendar entry, notes passed
 * to the founders), the scoreboard events, the booking-time availability re-check, the callback owner,
 * and the failure cases.
 *
 * Run from the repo root:  npx tsx scripts/checks/call-outcome.check.ts
 */
import { applyOutcome } from "../../src/lib/hq/call-lead-outcome";

type Row = Record<string, any>;
const get = (r: Row, col: string) => col.includes("->>") ? col.split("->>").reduce((a: any, k, i) => i === 0 ? r[k] : a?.[k], null as any) : r[col];

function makeDb(seed: Record<string, Row[]>, opts: { failUpdateColumn?: string } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const fail: { table: string; op: string }[] = [];
  const updates: Row[] = [];
  let n = 0;
  class Q {
    mode = "select"; payload: any; returning = false; head = false;
    filters: ((r: Row) => boolean)[] = []; ord: [string, boolean][] = []; lim = Infinity; one: "single" | "maybe" | null = null;
    constructor(public t: string) {}
    select(_c?: string, o?: { head?: boolean }) { if (this.mode !== "select") this.returning = true; else this.head = !!o?.head; return this; }
    insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
    update(p: any) { this.mode = "update"; this.payload = p; return this; }
    eq(c: string, v: any) { this.filters.push((r) => String(get(r, c)) === String(v)); return this; }
    in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(get(r, c))); return this; }
    gte(c: string, v: any) { this.filters.push((r) => new Date(get(r, c)).getTime() >= new Date(v).getTime()); return this; }
    lte(c: string, v: any) { this.filters.push((r) => r[c] != null && new Date(get(r, c)).getTime() <= new Date(v).getTime()); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.ord.push([c, o?.ascending !== false]); return this; }
    limit(x: number) { this.lim = x; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run(): any {
      if (fail.some((f) => f.table === this.t && f.op === this.mode)) return { data: null, error: { message: `injected ${this.mode} failure on ${this.t}` } };
      const rows = (tables[this.t] ??= []);
      if (this.mode === "insert") {
        const made = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({ id: `${this.t}-${++n}`, ...(this.t === "prospect_events" ? { occurred_at: new Date().toISOString() } : {}), ...p }));
        rows.push(...made);
        return this.finish(made);
      }
      let hit = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "update") {
        if (opts.failUpdateColumn && this.t === "call_leads" && opts.failUpdateColumn in this.payload) return { data: null, error: { message: `column "${opts.failUpdateColumn}" of relation "call_leads" does not exist` } };
        updates.push({ table: this.t, ...this.payload });
        hit.forEach((r) => Object.assign(r, this.payload)); return this.finish(hit);
      }
      for (const [c, asc] of [...this.ord].reverse()) hit = [...hit].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      if (this.head) return { data: null, count: hit.length, error: null };
      return this.finish(hit.slice(0, this.lim));
    }
    finish(rs: Row[]) {
      const out = this.mode === "select" || this.returning ? rs.map((r) => ({ ...r })) : null;
      if (this.one && out) return out.length ? { data: out[0], error: null } : this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out, error: null };
    }
  }
  return { tables, fail, updates, from: (t: string) => new Q(t) } as any;
}

let fails = 0, passes = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) passes++; else { fails++; console.log("FAIL", name, detail === undefined ? "" : JSON.stringify(detail)); } };

const baseLead = (over: Row = {}): Row => ({ id: "L1", business_name: "Breeze Dental Helensvale", phone: "(07) 5555 1234", phone_e164: "+61755551234", website: "https://breeze.com.au", email: "hi@breeze.com.au", address: "1 Main St, Helensvale QLD", category: "Dentist", status: "new", attempts: 0, callback_at: null, callback_by: null, last_called_at: null, client_id: null, ...over });
const caller = { email: "Aaron.D@agentivory.com" };
const when = "2026-10-20T03:00:00.000Z";

(async () => {
  // note only
  let db = makeDb({ call_leads: [baseLead()] });
  let r = await applyOutcome(db, caller, "L1", { outcome: "note", note: "  Owner is Dr Chen, back Tuesday  " });
  ok("note: 200", r.status === 200, r);
  ok("note: lead untouched", db.tables.call_leads[0].status === "new" && db.tables.call_leads[0].attempts === 0 && !db.tables.call_leads[0].last_called_at);
  ok("note: saved trimmed, as the caller", db.tables.call_lead_notes[0].body === "Owner is Dr Chen, back Tuesday" && db.tables.call_lead_notes[0].actor === "caller" && db.tables.call_lead_notes[0].created_by === caller.email);
  ok("note: no scoreboard event", !(db.tables.prospect_events ?? []).length);
  r = await applyOutcome(db, caller, "L1", { outcome: "note", note: "   " });
  ok("empty note: 400", r.status === 400, r);

  // no answer
  db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "no_answer" });
  const L = db.tables.call_leads[0];
  ok("no_answer: status/attempts/time", L.status === "no_answer" && L.attempts === 1 && !!L.last_called_at, L);
  const ev = db.tables.prospect_events[0];
  ok("no_answer: scoreboard event", ev.type === "cold_call" && ev.actor === "caller" && ev.detail.source === "motivation" && ev.detail.result === "no_answer" && ev.detail.via === "call_list" && ev.detail.lead_id === "L1", ev);
  ok("no_answer: stats and counts", (r.json.stats as any).calls === 1 && (r.json.stats as any).noAnswer === 1 && JSON.stringify(r.json.counts) === JSON.stringify({ todo: 1, callbacks: 0, done: 0, due: 0 }), [r.json.stats, r.json.counts]);

  // voicemail on a promised callback keeps it a callback
  db = makeDb({ call_leads: [baseLead({ status: "callback", callback_at: when, callback_by: "aaron.d@agentivory.com", attempts: 1 })] });
  r = await applyOutcome(db, caller, "L1", { outcome: "voicemail", note: "left message" });
  ok("voicemail on callback: stays a callback, owner kept", db.tables.call_leads[0].status === "callback" && db.tables.call_leads[0].callback_at === when && db.tables.call_leads[0].callback_by === "aaron.d@agentivory.com" && db.tables.call_leads[0].attempts === 2, db.tables.call_leads[0]);

  // closing outcomes clear the callback and its owner
  for (const [o, dial] of [["not_interested", "dialed"], ["wrong_number", "dialed"], ["do_not_call", "dialed"]] as const) {
    db = makeDb({ call_leads: [baseLead({ status: "callback", callback_at: when, callback_by: "aaron.d@agentivory.com" })] });
    r = await applyOutcome(db, caller, "L1", { outcome: o });
    ok(`${o}: status, callback and owner cleared`, db.tables.call_leads[0].status === o && db.tables.call_leads[0].callback_at === null && db.tables.call_leads[0].callback_by === null, db.tables.call_leads[0]);
    ok(`${o}: counts as a dial, lands in Done`, db.tables.prospect_events[0].detail.result === dial && (r.json.counts as any).done === 1 && (r.json.counts as any).callbacks === 0);
  }

  // callback
  db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "callback", note: "ask for Sarah after 3", when });
  ok("callback: status, time and OWNER (lower-cased email)", db.tables.call_leads[0].status === "callback" && db.tables.call_leads[0].callback_at === when && db.tables.call_leads[0].callback_by === "aaron.d@agentivory.com", db.tables.call_leads[0]);
  ok("callback: scoreboard event carries the time", db.tables.prospect_events[0].detail.result === "callback" && db.tables.prospect_events[0].detail.when === when);
  ok("callback: NOT on the shared calendar or the global tasks", !(db.tables.meetings ?? []).length && !(db.tables.tasks ?? []).length);
  db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "callback", note: "x" });
  ok("callback without a time: 400, nothing written", r.status === 400 && db.tables.call_leads[0].status === "new" && !(db.tables.call_lead_notes ?? []).length, r);
  r = await applyOutcome(db, caller, "L1", { outcome: "callback", when: "not a date" });
  ok("callback with a bad time: 400", r.status === 400, r);
  // before the migration: no callback_by column
  db = makeDb({ call_leads: [baseLead()] }, { failUpdateColumn: "callback_by" });
  r = await applyOutcome(db, caller, "L1", { outcome: "callback", when });
  ok("callback still saves when the callback_by column doesn't exist yet", r.status === 200 && db.tables.call_leads[0].status === "callback" && db.tables.call_leads[0].callback_at === when, r);

  // booking
  db = makeDb({ call_leads: [baseLead({ status: "voicemail", attempts: 2 })], call_lead_notes: [
    { id: "n1", lead_id: "L1", outcome: "no_answer", body: "rang out", occurred_at: "2026-10-19T00:10:00.000Z" },
    { id: "n2", lead_id: "L1", outcome: "voicemail", body: "left a message\nfor the owner", occurred_at: "2026-10-19T04:00:00.000Z" }] });
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when });
  ok("booked: missing 'with' -> 400", r.status === 400, r);
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "bob" });
  ok("booked: bad 'with' -> 400", r.status === 400, r);
  ok("booked: nothing written on validation errors", !(db.tables.clients ?? []).length && !(db.tables.deals ?? []).length && db.tables.call_leads[0].status === "voicemail");
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", note: "Misses calls after hours, 3 dentists, uses Dentally", when, with: "ryan", contact_name: "Dr Sarah Chen" });
  ok("booked: 200", r.status === 200, r);
  const client = db.tables.clients[0];
  ok("booked: client created with contact + lead details", client.company_name === "Breeze Dental Helensvale" && client.contact_name === "Dr Sarah Chen" && client.email === "hi@breeze.com.au" && client.phone === "(07) 5555 1234", client);
  ok("booked: client notes carry the caller's whole history + this note", /Caller notes:/.test(client.notes) && /No answer: rang out/.test(client.notes) && /Voicemail: left a message for the owner/.test(client.notes) && /Misses calls after hours/.test(client.notes) && /Dentist · 1 Main St/.test(client.notes), client.notes);
  ok("booked: deal at call_booked", db.tables.deals[0].client_id === client.id && db.tables.deals[0].current_stage === "call_booked");
  const m = db.tables.meetings[0];
  ok("booked: calendar entry says who booked and who it's for, 30 minutes", m.title === "Sales call — Breeze Dental Helensvale · Aaron → Ryan" && m.start_time === when && new Date(m.end_time).getTime() - new Date(m.start_time).getTime() === 1800000 && m.linked_client_id === client.id, m);
  const demo = db.tables.prospect_events.find((e: Row) => e.type === "demo"), dial = db.tables.prospect_events.find((e: Row) => e.type === "cold_call");
  ok("booked: 'demo' event with who it's with, plus a dial", demo.actor === "caller" && demo.detail.with === "ryan" && demo.detail.lead_id === "L1" && demo.detail.client_id === client.id && dial.detail.result === "dialed", [demo, dial]);
  const BL = db.tables.call_leads[0];
  ok("booked: lead updated, callback cleared", BL.status === "booked" && BL.client_id === client.id && BL.attempts === 3 && BL.callback_at === null && BL.callback_by === null, BL);
  ok("booked: stats", (r.json.stats as any).booked === 1 && (r.json.stats as any).calls === 1, r.json.stats);
  const before = JSON.stringify(db.tables);
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "ryan" });
  ok("booking again: 409 and nothing written", r.status === 409 && JSON.stringify(db.tables) === before, r);

  db = makeDb({ call_leads: [baseLead()] });
  await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "either" });
  ok("booked 'either': title names both", db.tables.meetings[0].title.endsWith("· Aaron → Ryan or Lachlan"), db.tables.meetings[0].title);
  db = makeDb({ call_leads: [baseLead()] });
  await applyOutcome(db, { email: "ryan@agentivory.com" }, "L1", { outcome: "no_answer" });
  ok("a founder keeps their own actor", db.tables.prospect_events[0].actor === "ryan");

  // ── the availability re-check at the moment of booking
  const calls: any[] = [];
  const checker = (result: { ok: true } | { ok: false; reason: string }) => async (w: Date, p: string, rw: boolean) => { calls.push({ when: w.toISOString(), p, rw }); return result as any; };
  db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "lachlan", slot: true }, { checkBookable: checker({ ok: true }) });
  ok("slot booking: checked once with the person, the time, and requireWindow=true", r.status === 200 && calls.length === 1 && calls[0].p === "lachlan" && calls[0].when === when && calls[0].rw === true, calls);
  calls.length = 0; db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, { email: "lachlan@agentivory.com" }, "L1", { outcome: "booked", when, with: "ryan" }, { checkBookable: checker({ ok: true }) });
  ok("a manager typing a time freely: checked for conflicts only (requireWindow=false)", r.status === 200 && calls[0].rw === false, calls);
  calls.length = 0; db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "ryan" }, { checkBookable: checker({ ok: true }), strictSlots: true });
  ok("someone limited to the booking buttons is always held to the offered hours", calls[0].rw === true, calls);
  calls.length = 0; db = makeDb({ call_leads: [baseLead({ status: "voicemail", attempts: 1 })] });
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "ryan", slot: true, note: "important" }, { checkBookable: checker({ ok: false, reason: "Ryan is not free then, or it was just taken. Pick another time." }) });
  ok("a taken slot is refused with a clear message (409, slotTaken)", r.status === 409 && /just taken/.test(String(r.json.error)) && r.json.slotTaken === true, r);
  ok("...and NOTHING was written: no client, deal, meeting, note, event, or lead change", !(db.tables.clients ?? []).length && !(db.tables.deals ?? []).length && !(db.tables.meetings ?? []).length && !(db.tables.call_lead_notes ?? []).length && !(db.tables.prospect_events ?? []).length && db.tables.call_leads[0].status === "voicemail" && db.tables.call_leads[0].attempts === 1, db.tables);
  calls.length = 0; db = makeDb({ call_leads: [baseLead()] });
  r = await applyOutcome(db, caller, "L1", { outcome: "callback", when }, { checkBookable: checker({ ok: false, reason: "nope" }) });
  ok("callbacks are never availability-checked (they're the caller's own time)", r.status === 200 && calls.length === 0, calls);

  // ── failures
  db = makeDb({ call_leads: [baseLead()] }); db.fail.push({ table: "clients", op: "insert" });
  r = await applyOutcome(db, caller, "L1", { outcome: "booked", when, with: "ryan" });
  ok("booking failure: error, lead and notes untouched", r.status === 500 && db.tables.call_leads[0].status === "new" && !(db.tables.call_lead_notes ?? []).length, r);
  db = makeDb({ call_leads: [baseLead()] }); db.fail.push({ table: "prospect_events", op: "insert" });
  r = await applyOutcome(db, caller, "L1", { outcome: "no_answer" });
  ok("scoreboard failure: still saved, warning shown", r.status === 200 && db.tables.call_leads[0].status === "no_answer" && /scoreboard/.test(String(r.json.warning)), r);
  db = makeDb({ call_leads: [baseLead()] }); db.fail.push({ table: "call_lead_notes", op: "insert" });
  r = await applyOutcome(db, caller, "L1", { outcome: "no_answer", note: "hello" });
  ok("note failure: lead still updated, warning shown", r.status === 200 && db.tables.call_leads[0].status === "no_answer" && /note wasn't saved/.test(String(r.json.warning)), r);
  r = await applyOutcome(db, caller, "L1", { outcome: "nonsense" });
  ok("invalid outcome: 400", r.status === 400);
  r = await applyOutcome(db, caller, "nope", { outcome: "no_answer" });
  ok("unknown lead: 404", r.status === 404);

  console.log(`\n${passes} passed, ${fails} failed`);
})();
