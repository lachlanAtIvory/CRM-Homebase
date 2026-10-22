/**
 * Checks the DialSheet integration (src/lib/hq/dialsheet.ts, dialsheet-events.ts, call-format.ts):
 * the signature (computed independently here with Node's crypto, in the form DialSheet's docs describe),
 * reading call.completed payloads, matching a call to a lead by phone number, repeated deliveries,
 * and what the screens read.
 *
 * Run from the repo root:  npx tsx scripts/checks/dialsheet.check.ts
 */
import { createHmac } from "node:crypto";
import { callTypeOf, checkSignature, normalizeContactNumber, parseEvent, safeRecordingUrl, secretsFrom, MAX_SKEW_MS } from "../../src/lib/hq/dialsheet";
import { describeCall, formatDuration } from "../../src/lib/hq/call-format";
import { handleWebhook, loadDialSheetStatus, fetchLeadCalls, mergeRows } from "../../src/lib/hq/dialsheet-events";

type Row = Record<string, any>;
let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

// ── 1. The signature: header "t=<unix seconds>,v1=<hex>", v1 = HMAC-SHA256(secret, `${t}.${rawBody}`)
const SECRET = "whsec_4f1c9a7e2b6d8035a1c4e7f90b2d6a38";
const NOW = Date.UTC(2026, 9, 23, 3, 0, 0);
const T = Math.floor(NOW / 1000);
const hmac = (key: string, t: number | string, body: string) => createHmac("sha256", key).update(`${t}.${body}`).digest("hex");
const BODY = JSON.stringify({ id: "evt_1", type: "call.completed", test: false, data: { call: { id: "c1" } } });
const header = (key = SECRET, t: number | string = T, body = BODY) => `t=${t},v1=${hmac(key, t, body)}`;
const check = (h: string | null | undefined, over: Partial<{ secrets: string[]; rawBody: string; now: number }> = {}) =>
  checkSignature({ secrets: [SECRET], header: h, rawBody: BODY, now: NOW, ...over });

eq("a correctly signed request is accepted", check(header()), { ok: true });
eq("...with the secret as DialSheet shows it, whsec_ included", check(header(SECRET)), { ok: true });
eq("...or signed with the key minus the whsec_ prefix (the docs don't say which)", check(header(SECRET.slice(6))), { ok: true });
eq("...case of the hex doesn't matter", check(`t=${T},v1=${hmac(SECRET, T, BODY).toUpperCase()}`), { ok: true });
eq("...spaces after the comma are fine", check(`t=${T}, v1=${hmac(SECRET, T, BODY)}`), { ok: true });
eq("...and several v1 values are fine if one matches (a secret being rotated)", check(`t=${T},v1=${"0".repeat(64)},v1=${hmac(SECRET, T, BODY)}`), { ok: true });
eq("a body changed after signing is refused", check(header(), { rawBody: BODY.replace("c1", "c2") }), { ok: false, reason: "mismatch" });
eq("a re-serialised body (same JSON, different bytes) is refused: the raw bytes are what's signed", check(header(), { rawBody: JSON.stringify(JSON.parse(BODY), null, 2) }), { ok: false, reason: "mismatch" });
eq("the wrong secret is refused", check(header("whsec_somethingelse")), { ok: false, reason: "mismatch" });
eq("a different timestamp than the one signed is refused", check(`t=${T + 1},v1=${hmac(SECRET, T, BODY)}`), { ok: false, reason: "mismatch" });
eq("no secret configured is refused", check(header(), { secrets: [] }), { ok: false, reason: "mismatch" });
eq("a missing header is refused", [check(null), check(undefined), check("")], Array(3).fill({ ok: false, reason: "missing" }));
eq("junk headers are refused", [check("garbage"), check("t=abc,v1=ff"), check(`t=${T}`), check(`v1=${hmac(SECRET, T, BODY)}`), check(`t=${T},v1=`)], Array(5).fill({ ok: false, reason: "malformed" }));
eq("a truncated signature is refused", check(`t=${T},v1=${hmac(SECRET, T, BODY).slice(0, 40)}`), { ok: false, reason: "mismatch" });
eq("a correctly signed request from 12 hours ago (the last retry) is accepted", check(header(SECRET, T - 12 * 3600)), { ok: true });
eq("one signed 3 days ago is refused as stale", check(header(SECRET, T - 3 * 86400)), { ok: false, reason: "stale" });
eq("one signed in the far future is refused as stale", check(header(SECRET, T + 3 * 86400)), { ok: false, reason: "stale" });
eq("the freshness window is 36 hours", MAX_SKEW_MS, 36 * 3600 * 1000);
eq("two people's webhooks: either secret works", [check(header("whsec_second"), { secrets: [SECRET, "whsec_second"] }), check(header(SECRET), { secrets: [SECRET, "whsec_second"] })], [{ ok: true }, { ok: true }]);
eq("secrets can be listed with commas, spaces or new lines", secretsFrom(" whsec_a, whsec_b\nwhsec_c  "), ["whsec_a", "whsec_b", "whsec_c"]);
eq("no secrets", [secretsFrom(undefined), secretsFrom(""), secretsFrom(" , ")], [[], [], []]);

// ── 2. Phone numbers the way DialSheet holds them
for (const [raw, want] of [
  ["07 5555 1234", "+61755551234"], ["(07) 5555 1234", "+61755551234"], ["0755551234", "+61755551234"], ["0412 345 678", "+61412345678"],
  ["+61 7 5555 1234", "+61755551234"], ["+61755551234", "+61755551234"], ["61755551234", "+61755551234"], ["61412345678", "+61412345678"],
  ["+61 (0)7 5555 1234", "+61755551234"], ["0011 61 7 5555 1234", "+61755551234"],
  ["+1-555-000-1234", "+15550001234"], ["+64 9 123 4567", "+6491234567"], ["16813810000", "+16813810000"], [61755551234, "+61755551234"],
  ["1300 123 456", null], ["1800 123 456", null], ["13 14 15", null], ["", null], [null, null], [undefined, null], ["123", null], ["call us", null], ["0123", null],
] as [unknown, string | null][]) eq(`number ${JSON.stringify(raw)}`, normalizeContactNumber(raw), want);

// ── 3. Reading events
const completed = (callOver: Row = {}, top: Row = {}) => ({
  id: "evt_5f1c", type: "call.completed", created_at: "2026-10-23T03:04:11Z", test: false,
  data: {
    call: {
      id: "c_501", status: "completed", duration_seconds: 184, started_at: "2026-10-23T03:01:00Z", ended_at: "2026-10-23T03:04:04Z",
      direction: null, from_number: "+15555550100", recording_url: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3",
      disposition: "interested", is_conversation: true, ai_summary: "Practice manager wants a demo on Thursday.", ai_disposition: "interested",
      ai_next_steps: "Send the demo link", has_transcript: true, transcript: "…long text we never store…",
      notes: [{ outcome: "interested", content: "Demo Thursday", created_at: "2026-10-23T03:05:00Z" }],
      leads: { id: "dsl_1", name: "Sam Lee", company: "Breeze Dental", phone: "07 5555 1234", email: "s@breeze.example", status: "interested", tags: [] },
      ...callOver,
    },
  },
  ...top,
});
const call = (callOver: Row = {}, top: Row = {}) => (parseEvent(completed(callOver, top)) as any).call;

eq("a normal call is read", (() => { const c = call(); return [c.providerCallId, c.direction, c.callType, c.durationSeconds, c.startedAt, c.disposition, c.notes, c.summary, c.nextSteps, c.contactNumber, c.contactE164, c.leadNames, c.rawType]; })(),
  ["c_501", "outgoing", "answered", 184, "2026-10-23T03:01:00.000Z", "interested", "Demo Thursday", "Practice manager wants a demo on Thursday.", "Send the demo link", "07 5555 1234", "+61755551234", ["Breeze Dental", "Sam Lee"], "completed"]);
eq("the recording link is kept (https)", call().recordingUrl, "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3");
eq("the transcript is never carried over", Object.values(call()).some((v) => typeof v === "string" && v.includes("never store")), false);
eq("a numeric call id becomes text", call({ id: 501 }).providerCallId, "501");
eq("no direction means Jan placed it", call({ direction: null }).direction, "outgoing");
eq("direction words", ["outbound", "outgoing", "Outbound", "inbound", "incoming", "Inbound"].map((d) => call({ direction: d }).direction), ["outgoing", "outgoing", "outgoing", "incoming", "incoming", "incoming"]);
eq("several notes are joined in order", call({ notes: [{ outcome: "callback", content: "Call back after 2" }, { outcome: "interested", content: "Then wants a demo" }] }).notes, "Call back after 2\nThen wants a demo");
eq("no disposition: the last note's outcome stands in", call({ disposition: null, notes: [{ outcome: "callback", content: "a" }, { outcome: "interested", content: "b" }] }).disposition, "interested");
eq("no notes, no summary: nothing invented", (() => { const c = call({ notes: [], disposition: null, ai_summary: null, ai_next_steps: null }); return [c.notes, c.disposition, c.summary, c.nextSteps]; })(), [null, null, null, null]);
eq("next steps given as a list become lines", call({ ai_next_steps: ["Send the link", "Ring Thursday"] }).nextSteps, "Send the link\nRing Thursday");
eq("start time falls back to end minus length", call({ started_at: null }).startedAt, "2026-10-23T03:01:00.000Z");
eq("...then to the event's own time", call({ started_at: null, ended_at: null }).startedAt, "2026-10-23T03:04:11.000Z");
eq("an unreadable start time doesn't break the call", call({ started_at: "whenever" }).startedAt, "2026-10-23T03:01:00.000Z");
eq("a lead with no phone still reads", (() => { const c = call({ leads: { id: "x", name: "Sam", company: null, phone: null } }); return [c.contactNumber, c.contactE164, c.leadNames]; })(), [null, null, ["Sam"]]);
eq("a call with no lead object at all still reads", (() => { const c = call({ leads: undefined }); return [c.contactE164, c.leadNames]; })(), [null, []]);
eq("a very long note is cut", call({ notes: [{ content: "x".repeat(10000) }] }).notes.length, 4000);

eq("a hostile recording link is dropped", [call({ recording_url: "javascript:alert(1)" }).recordingUrl, call({ recording_url: "http://insecure.example/r.mp3" }).recordingUrl, call({ recording_url: "//evil.example" }).recordingUrl, call({ recording_url: "not a url" }).recordingUrl, call({ recording_url: null }).recordingUrl], [null, null, null, null, null]);
eq("recording links: https only", [safeRecordingUrl("https://a.example/r.mp3"), safeRecordingUrl("data:text/html,x"), safeRecordingUrl(""), safeRecordingUrl(5)], ["https://a.example/r.mp3", null, null, null]);

for (const [opts, want] of [
  [{ isConversation: true, disposition: "interested", status: "completed" }, "answered"],
  [{ isConversation: false, disposition: null, status: "completed" }, "unanswered"],
  [{ isConversation: false, disposition: "voicemail", status: "completed" }, "voicemail"],
  [{ isConversation: false, disposition: "Voicemail", status: "completed" }, "voicemail"],
  [{ isConversation: false, disposition: "no answer", status: "completed" }, "unanswered"],
  [{ isConversation: false, disposition: "no_answer", status: "completed" }, "unanswered"],
  [{ isConversation: true, disposition: "callback", status: "completed" }, "answered"],
  [{ isConversation: false, disposition: "interested", status: "failed" }, "failed"],
  [{ isConversation: true, status: "canceled" }, "failed"],
  [{ status: "busy" }, "unanswered"],
  [{ status: "completed" }, "other"],
  [{}, null],
] as [Parameters<typeof callTypeOf>[0], string | null][]) eq(`call type ${JSON.stringify(opts)}`, callTypeOf(opts), want);

eq("the Send test button's event is recognised and not saved", parseEvent(completed({}, { test: true })), { kind: "test" });
eq("a test event with nothing else in it is still a test", parseEvent({ type: "call.completed", test: true }), { kind: "test" });
eq("some other event type is ignored", parseEvent({ id: "e", type: "call.started", data: { call: { id: "x" } } }), { kind: "ignore", type: "call.started" });
eq("a call without an id can't be saved", (parseEvent({ type: "call.completed", data: { call: { status: "completed" } } }) as any).kind, "ignore");
eq("no data at all can't be saved", (parseEvent({ type: "call.completed" }) as any).kind, "ignore");
eq("not a DialSheet payload at all", [parseEvent(null), parseEvent("x"), parseEvent({}), parseEvent({ data: {} }), parseEvent([])], [null, null, null, null, null]);

eq("durations", [formatDuration(130), formatDuration(45), formatDuration(0), formatDuration(3600), formatDuration(null)], ["2m 10s", "45s", "0s", "60m 00s", ""]);
eq("descriptions", [
  describeCall({ direction: "outgoing", call_type: "answered", duration_seconds: 133 }),
  describeCall({ direction: "outgoing", call_type: "unanswered", duration_seconds: 20 }),
  describeCall({ direction: "incoming", call_type: "missed", duration_seconds: null }),
  describeCall({ direction: "incoming", call_type: "voicemail", duration_seconds: 22 }),
  describeCall({ direction: "outgoing", call_type: "failed", duration_seconds: 0 }),
  describeCall({ direction: null, call_type: null, duration_seconds: null }),
], ["Outgoing · answered · 2m 13s", "Outgoing · no answer", "Incoming · missed", "Incoming · voicemail · 22s", "Outgoing · didn't connect", "Outgoing · call"]);

eq("merging: new values win, empty ones never wipe", mergeRows({ a: 1, b: 2, c: null }, { a: null, b: 3, c: 4, d: undefined }), { a: 1, b: 3, c: 4 });

// ── 4. The webhook handler against an in-memory database
function makeDb(seed: Record<string, Row[]> = {}, opts: { failInsertOn?: string } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  class Q {
    mode = "select"; payload: any; returning = false; f: ((r: Row) => boolean)[] = []; ord: [string, boolean][] = []; lim = Infinity; one: "single" | "maybe" | null = null;
    constructor(public t: string) {}
    select() { if (this.mode !== "select") this.returning = true; return this; }
    insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
    update(p: any) { this.mode = "update"; this.payload = p; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    gte(c: string, v: any) { this.f.push((r) => new Date(r[c]).getTime() >= new Date(v).getTime()); return this; }
    order(c: string, o?: any) { this.ord.push([c, o?.ascending !== false]); return this; }
    limit(x: number) { this.lim = x; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run(): any {
      const rows = (tables[this.t] ??= []);
      if (this.mode === "insert") {
        if (opts.failInsertOn === this.t) return { data: null, error: { message: "injected failure" } };
        const row = { id: `${this.t}-${++n}`, created_at: new Date(2026, 9, 23, 3, n).toISOString(), received_at: new Date().toISOString(), ...this.payload };
        if (this.t === "call_activity" && rows.some((r) => r.provider === row.provider && r.provider_call_id === row.provider_call_id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.push(row); return this.fin([row]);
      }
      let hit = rows.filter((r) => this.f.every((g) => g(r)));
      if (this.mode === "update") { hit.forEach((r) => Object.assign(r, this.payload)); return this.fin(hit); }
      for (const [c, asc] of [...this.ord].reverse()) hit = [...hit].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      return this.fin(hit.slice(0, this.lim));
    }
    fin(rs: Row[]) {
      const out = rs.map((r) => ({ ...r }));
      if (this.one) return out.length ? { data: out[0], error: null } : this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out, error: null };
    }
  }
  return { tables, from: (t: string) => new Q(t) } as any;
}

/** A request exactly as DialSheet would send it. */
function req(body: any, over: { secret?: string; key?: string; t?: number; signature?: string | null; raw?: string } = {}) {
  const rawBody = over.raw ?? JSON.stringify(body);
  const signature = over.signature === undefined ? `t=${over.t ?? T},v1=${hmac(over.key ?? SECRET, over.t ?? T, rawBody)}` : over.signature;
  return { rawBody, signature, secret: over.secret ?? SECRET, now: NOW };
}
const lead = (id: string, e164: string | null, name = "Some Practice", over: Row = {}) => ({ id, phone_e164: e164, business_name: name, status: "new", updated_at: "2026-10-19T00:00:00Z", ...over });

(async () => {
  // refused / misconfigured / junk
  let db = makeDb({ call_leads: [lead("L1", "+61755551234", "Breeze Dental")] });
  let r = await handleWebhook(db, req(completed(), { signature: `t=${T},v1=${"0".repeat(64)}` }));
  eq("a bad signature is refused (401) and nothing is saved", [r.status, (db.tables.call_activity ?? []).length], [401, 0]);
  eq("...and the refusal is logged with a plain reason", [db.tables.dialsheet_events.at(-1).outcome, /signing secret/.test(db.tables.dialsheet_events.at(-1).detail)], ["rejected", true]);
  r = await handleWebhook(db, req(completed(), { signature: null }));
  eq("no signature header: 401", r.status, 401);
  r = await handleWebhook(db, req(completed(), { signature: "t=1,v1=deadbeef" }));
  eq("a malformed header: 401, and the log says so", [r.status, /expected form/.test(db.tables.dialsheet_events.at(-1).detail)], [401, true]);
  r = await handleWebhook(db, req(completed(), { key: "whsec_not_ours" }));
  eq("signed with some other secret: 401", [r.status, (db.tables.call_activity ?? []).length], [401, 0]);
  r = await handleWebhook(db, req(completed(), { t: T - 3 * 86400 }));
  eq("a replayed old request is refused", r.status, 401);
  r = await handleWebhook(db, { ...req(completed()), secret: undefined });
  eq("DIALSHEET_WEBHOOK_SECRET not set: 503 (DialSheet retries), nothing saved", [r.status, (db.tables.call_activity ?? []).length], [503, 0]);
  r = await handleWebhook(db, { ...req(completed()), secret: " , " });
  eq("a blank secret counts as not set", r.status, 503);
  r = await handleWebhook(db, req(null, { raw: "not json" }));
  eq("junk body: 400", r.status, 400);
  r = await handleWebhook(db, req(null, { raw: "[1,2]" }));
  eq("a JSON list instead of an object: 400", r.status, 400);
  r = await handleWebhook(db, req({ hello: "world" }));
  eq("signed, but not a DialSheet event: 400", r.status, 400);

  // test button, other events
  db = makeDb({ call_leads: [lead("L1", "+61755551234", "Breeze Dental")] });
  r = await handleWebhook(db, req(completed({}, { test: true })));
  eq("DialSheet's Send test: 200, nothing saved, noted in the log", [r.status, r.json.test, (db.tables.call_activity ?? []).length, db.tables.dialsheet_events.at(-1).outcome], [200, true, 0, "ignored"]);
  r = await handleWebhook(db, req({ id: "e", type: "call.started", data: { call: { id: "x" } } }));
  eq("an event we don't use: 200 and nothing saved", [r.status, r.json.ignored, (db.tables.call_activity ?? []).length], [200, "call.started", 0]);
  r = await handleWebhook(db, req({ id: "e", type: "call.completed", data: { call: { status: "completed" } } }));
  eq("a call with no id: 200 (retrying wouldn't help) and not saved", [r.status, (db.tables.call_activity ?? []).length], [200, 0]);

  // a normal call
  r = await handleWebhook(db, req(completed()));
  const row = db.tables.call_activity[0];
  eq("a finished call is saved and matched to the lead by phone", [r.status, r.json.matched, row.lead_id, row.provider, row.provider_call_id, row.direction, row.call_type], [200, true, "L1", "dialsheet", "c_501", "outgoing", "answered"]);
  eq("...with its outcome, notes, summary, next step, length, time and recording", [row.disposition, row.notes, row.summary, row.next_steps, row.duration_seconds, row.started_at, row.recording_url], ["interested", "Demo Thursday", "Practice manager wants a demo on Thursday.", "Send the demo link", 184, "2026-10-23T03:01:00.000Z", "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3"]);
  eq("...and logged as processed against the lead", [db.tables.dialsheet_events.at(-1).outcome, db.tables.dialsheet_events.at(-1).lead_id], ["processed", "L1"]);

  // the same event again (at-least-once delivery)
  r = await handleWebhook(db, req(completed()));
  eq("DialSheet delivering it again doesn't duplicate (still one row)", [r.status, db.tables.call_activity.length], [200, 1]);
  // ...with an edit: new notes arrive, nothing else is lost
  r = await handleWebhook(db, req(completed({ notes: [{ outcome: "interested", content: "Demo Thursday 2pm" }], recording_url: null, ai_summary: null })));
  const after = db.tables.call_activity[0];
  eq("a later delivery updates what changed", after.notes, "Demo Thursday 2pm");
  eq("...without wiping what it doesn't carry", [after.summary, after.recording_url, after.lead_id, after.duration_seconds], ["Practice manager wants a demo on Thursday.", "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3", "L1", 184]);
  eq("...and still one row", db.tables.call_activity.length, 1);

  // two signing secrets (two people's webhooks)
  db = makeDb({ call_leads: [lead("L1", "+61755551234")] });
  r = await handleWebhook(db, { ...req(completed(), { key: "whsec_second" }), secret: `${SECRET}, whsec_second` });
  eq("a second webhook's own secret is accepted too", [r.status, db.tables.call_activity.length], [200, 1]);

  // matching when several leads share a number (group practices)
  db = makeDb({ call_leads: [lead("OLD", "+61755551234", "Southport Dental", { updated_at: "2026-10-01T00:00:00Z" }), lead("NEW", "+61755551234", "Other Practice", { updated_at: "2026-10-20T00:00:00Z" }), lead("ELSE", "+61299990000", "Breeze Dental")] });
  r = await handleWebhook(db, req(completed({ leads: { id: "d", name: "Sam", company: "Southport Dental!", phone: "07 5555 1234" } })));
  eq("same number on two leads: the one whose business name matches wins, even if older", db.tables.call_activity[0].lead_id, "OLD");
  db = makeDb({ call_leads: [lead("A", "+61755551234", "Alpha", { updated_at: "2026-10-10T00:00:00Z" }), lead("B", "+61755551234", "Beta", { updated_at: "2026-10-18T00:00:00Z" })] });
  r = await handleWebhook(db, req(completed({ leads: { id: "d", name: null, company: "Not Either Of Them", phone: "07 5555 1234" } })));
  eq("no name match: the most recently touched lead with the number wins", db.tables.call_activity[0].lead_id, "B");
  r = await handleWebhook(db, req(completed({ id: "c_502", leads: { id: "d", name: null, company: null, phone: "0755551234" } })));
  eq("a number typed differently in DialSheet still matches", db.tables.call_activity[1].lead_id, "B");
  r = await handleWebhook(db, req(completed({ id: "c_503", leads: { id: "d", phone: "+61 7 5555 1234" } })));
  eq("...including with +61 and spaces", db.tables.call_activity[2].lead_id, "B");

  // unmatched, voicemail, no answer, incoming
  db = makeDb({ call_leads: [lead("X", "+61299990000")] });
  r = await handleWebhook(db, req(completed()));
  eq("a call to a number we don't have is saved, unmatched, and logged", [r.status, r.json.matched, db.tables.call_activity[0].lead_id, db.tables.dialsheet_events.at(-1).outcome], [200, false, null, "unmatched"]);
  eq("...with a helpful reason", /No lead has the number \+61755551234/.test(db.tables.dialsheet_events.at(-1).detail), true);
  db = makeDb({ call_leads: [lead("A", "+61755551234")] });
  await handleWebhook(db, req(completed({ id: "v1", is_conversation: false, disposition: "voicemail", ai_summary: null, notes: [] })));
  await handleWebhook(db, req(completed({ id: "n1", is_conversation: false, disposition: null, notes: [] })));
  await handleWebhook(db, req(completed({ id: "i1", direction: "inbound" })));
  eq("voicemail, no answer and an inbound call land on the lead as such", db.tables.call_activity.map((c: Row) => [c.call_type, c.direction, c.lead_id]), [["voicemail", "outgoing", "A"], ["unanswered", "outgoing", "A"], ["answered", "incoming", "A"]]);
  db = makeDb({ call_leads: [lead("C", null, "1300 Co")] });
  r = await handleWebhook(db, req(completed({ leads: { id: "d", company: "1300 Co", phone: "1300 123 456" } })));
  eq("a 1300 number can't be matched: saved, unmatched, no crash", [r.status, r.json.matched], [200, false]);

  // database trouble -> 500 so DialSheet retries; nothing half-saved
  db = makeDb({ call_leads: [lead("L1", "+61755551234")] }, { failInsertOn: "call_activity" });
  r = await handleWebhook(db, req(completed()));
  eq("a database failure answers 500 (DialSheet retries)", [r.status, (db.tables.call_activity ?? []).length], [500, 0]);
  eq("...and says so in the log", db.tables.dialsheet_events.at(-1).outcome, "error");

  // what the screens read
  db = makeDb({ call_activity: [
    { id: "1", lead_id: "L", started_at: "2026-10-23T01:00:00Z", call_type: "answered", direction: "outgoing", created_at: "x" },
    { id: "2", lead_id: "L", started_at: "2026-10-23T03:00:00Z", call_type: "unanswered", direction: "outgoing", created_at: "x" },
    { id: "3", lead_id: "OTHER", started_at: "2026-10-23T04:00:00Z", call_type: "answered", direction: "outgoing", created_at: "x" } ] });
  eq("a lead's calls are newest first and only that lead's", (await fetchLeadCalls(db, "L")).map((c) => c.id), ["2", "1"]);
  eq("before the DialSheet migration: no calls, no crash", (await fetchLeadCalls({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "42P01", message: "does not exist" } }) }) }) }) }) } as any, "L")).length, 0);

  db = makeDb({
    dialsheet_events: [
      { id: "e0", received_at: "2026-10-23T01:00:00Z", event_type: "call.completed", outcome: "processed" },
      { id: "e1", received_at: "2026-10-23T02:00:00Z", event_type: "call.completed", outcome: "ignored", detail: "Test event" },
      { id: "e2", received_at: "2026-10-23T03:00:00Z", event_type: "call.completed", outcome: "rejected", detail: "Signature didn't match" } ],
    call_activity: [{ id: "c1", created_at: new Date(NOW - 3600 * 1000).toISOString() }, { id: "c2", created_at: new Date(NOW - 48 * 3600 * 1000).toISOString() }] });
  const st = await loadDialSheetStatus(db, { DIALSHEET_WEBHOOK_SECRET: "whsec_x" } as any, new Date(NOW));
  eq("status: secret set, newest event first, calls in the last 24h", [st.secretConfigured, st.setupNeeded, st.calls24h, st.events.map((e) => e.id)], [true, false, 1, ["e2", "e1", "e0"]]);
  eq("status: a refused request doesn't count as DialSheet reaching us", st.lastEventAt, "2026-10-23T02:00:00Z");
  const st2 = await loadDialSheetStatus(db, {} as any, new Date(NOW));
  eq("status: nothing configured", [st2.secretConfigured], [false]);
  const st3 = await loadDialSheetStatus({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }) } as any, {} as any, new Date(NOW));
  eq("status: before the migration -> setupNeeded", st3.setupNeeded, true);
  const st4 = await loadDialSheetStatus(makeDb({ dialsheet_events: [{ id: "e", received_at: "2026-10-23T03:00:00Z", outcome: "rejected" }] }), {} as any, new Date(NOW));
  eq("status: only refused requests so far -> not 'sending calls' yet", st4.lastEventAt, null);

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
