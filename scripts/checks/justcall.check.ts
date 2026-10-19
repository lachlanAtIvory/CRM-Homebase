/**
 * Checks the JustCall integration (src/lib/hq/justcall.ts, justcall-events.ts, justcall-dial.ts):
 * the signature (against the test vector printed in JustCall's own docs), reading call payloads,
 * matching a call to a lead, out-of-order / repeated events, and the click-to-dial link.
 *
 * Run from the repo root:  npx tsx scripts/checks/justcall.check.ts
 */
import { callTypeOf, describeCall, expectedSignature, formatDuration, normalizeContactNumber, parseEvent, safeRecordingUrl, timestampFresh, verifySignature } from "../../src/lib/hq/justcall";
import { handleWebhook, loadJustCallStatus, fetchLeadCalls } from "../../src/lib/hq/justcall-events";
import { dialerUrl } from "../../src/lib/hq/justcall-dial";

type Row = Record<string, any>;
let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

// ── 1. The signature, against JustCall's published example
const DOC = {
  secret: "ea39089c40790e9dc7a080ec95e849b8fa0fa5fb",
  webhookUrl: "https://webhook.site/3bcea770-370a-4b09-8b66-426f687e08a4",
  type: "call.completed",
  timestamp: "2024-03-21 17:08:22",
  signature: "56761bae5b27a784a3ddd2af828bc5def7176bc0a8650199b04c737bd39bbecf",
};
eq("DOCS TEST VECTOR: our signature matches the one JustCall prints", expectedSignature(DOC), DOC.signature);
eq("verifySignature accepts the documented example", verifySignature(DOC), true);
eq("...case of the hex doesn't matter", verifySignature({ ...DOC, signature: DOC.signature.toUpperCase() }), true);
eq("wrong secret refused", verifySignature({ ...DOC, secret: "nope" }), false);
eq("a different event type refused", verifySignature({ ...DOC, type: "call.updated" }), false);
eq("a different timestamp refused", verifySignature({ ...DOC, timestamp: "2024-03-21 17:08:23" }), false);
eq("a different webhook URL refused", verifySignature({ ...DOC, webhookUrl: "https://evil.example/hook" }), false);
eq("a truncated signature refused", verifySignature({ ...DOC, signature: DOC.signature.slice(0, 40) }), false);
eq("an empty signature refused", verifySignature({ ...DOC, signature: "" }), false);
eq("no secret refused", verifySignature({ ...DOC, secret: "" }), false);

const NOWMS = Date.UTC(2026, 9, 20, 3, 0, 0);
eq("timestamp: within a day is fresh", timestampFresh("2026-10-20 14:00:00", NOWMS), true);
eq("timestamp: a replay from last year is stale", timestampFresh("2025-10-20 03:00:00", NOWMS), false);
eq("timestamp: 3 days old is stale", timestampFresh("2026-10-17 03:00:00", NOWMS), false);
eq("timestamp: unreadable text passes (the signature vouches for it)", timestampFresh("whenever", NOWMS), true);

// ── 2. Phone numbers the way JustCall sends them
for (const [raw, want] of [
  ["61755551234", "+61755551234"], ["+61 7 5555 1234", "+61755551234"], ["0755551234", "+61755551234"], ["0412345678", "+61412345678"],
  ["61412345678", "+61412345678"], ["(07) 5555 1234", "+61755551234"], ["+64 9 123 4567", "+6491234567"], ["16813810000", "+16813810000"],
  ["", null], [null, null], ["123", null], ["call us", null],
] as [unknown, string | null][]) eq(`number ${JSON.stringify(raw)}`, normalizeContactNumber(raw), want);

// ── 3. Reading events
const LEAD = "6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const completed = (over: Row = {}, info: Row = {}, dur: Row = {}) => ({
  request_id: "r1", webhook_url: DOC.webhookUrl, url_id: 7, type: "call.completed", metadata: { lead_id: LEAD },
  data: {
    id: 501, call_sid: "CA123", contact_number: "61755551234", contact_name: "Breeze Dental", justcall_number: "61280001111",
    agent_id: 9, agent_name: "Jan K", agent_email: "Jan@Agentivory.com", call_date: "2026-10-20", call_time: "03:14:13",
    call_user_date: "2026-10-20", call_user_time: "14:14:13",
    call_info: { direction: "Outgoing", type: "answered", disposition: "", notes: "", rating: "0", recording: "https://callingservice.justcall.io/rec?id=1", ...info },
    call_duration: { friendly_duration: "00:02:10", total_duration: 133, conversation_time: 130, hold_time: 3, ...dur },
    ...over,
  },
});
let ev: any = parseEvent(completed());
eq("completed: kind and event type", [ev.kind, ev.type], ["completed", "call.completed"]);
const c = ev.call;
eq("completed: ids, direction, type", [c.providerCallId, c.callSid, c.direction, c.callType, c.source], ["501", "CA123", "outgoing", "answered", "justcall"]);
eq("completed: number normalised, our line, agent lower-cased", [c.contactNumber, c.contactE164, c.justcallNumber, c.agentEmail, c.agentName], ["61755551234", "+61755551234", "61280001111", "jan@agentivory.com", "Jan K"]);
eq("completed: start time is the UTC date + time", c.startedAt, "2026-10-20T03:14:13.000Z");
eq("completed: durations in seconds", [c.durationSeconds, c.conversationSeconds], [133, 130]);
eq("completed: recording link kept, blank fields become null", [c.recordingUrl, c.disposition, c.notes, c.rating], ["https://callingservice.justcall.io/rec?id=1", null, null, 0]);
eq("completed: our lead id comes back from the metadata", c.leadIdHint, LEAD);
eq("metadata as a JSON STRING works too", (parseEvent({ ...completed(), metadata: JSON.stringify({ lead_id: LEAD }) }) as any).call.leadIdHint, LEAD);
eq("metadata that isn't a lead id is ignored", [(parseEvent({ ...completed(), metadata: { lead_id: "nope" } }) as any).call.leadIdHint, (parseEvent({ ...completed(), metadata: "garbage{" }) as any).call.leadIdHint, (parseEvent({ ...completed(), metadata: {} }) as any).call.leadIdHint], [null, null, null]);

ev = parseEvent({ ...completed(), type: "call.updated", data: { id: 501, call_sid: "CA123", cost_incurred: 0.04, call_info: { type: "Answered", disposition: "Sales: Lead", notes: "Wants a demo Tuesday", rating: "5" } } });
eq("updated: only the changed fields", [ev.kind, ev.call.providerCallId, ev.call.disposition, ev.call.notes, ev.call.rating, ev.call.contactNumber, ev.call.direction, ev.call.startedAt, ev.call.durationSeconds], ["updated", "501", "Sales: Lead", "Wants a demo Tuesday", 5, null, null, null, null]);

ev = parseEvent({ ...completed({ id: null }), type: "call.completed" });
eq("an event with no numeric id falls back to the call_sid", ev.call.providerCallId, "CA123");
eq("no id and no sid is ignored", parseEvent({ ...completed({ id: null, call_sid: null }) })?.kind, "ignore");

ev = parseEvent({ ...completed({}, { direction: "Incoming", type: "Missed" }), type: "call.completed", metadata: {} });
eq("incoming missed call", [ev.call.direction, ev.call.callType], ["incoming", "missed"]);
ev = parseEvent(completed({}, { direction: "Incoming", type: "voicemail", voicemail_transcription: "Hi, calling back about the AI receptionist" }));
eq("voicemail text kept", [ev.call.callType, ev.call.voicemailText], ["voicemail", "Hi, calling back about the AI receptionist"]);
ev = parseEvent(completed({}, { type: "Unanswered" }, { total_duration: 0, conversation_time: 0 }));
eq("unanswered outgoing", [ev.call.callType, ev.call.durationSeconds], ["unanswered", 0]);

// Sales Dialer
ev = parseEvent({ webhook_url: DOC.webhookUrl, type: "sd.call_completed", metadata: {}, data: {
  call_id: 9001, call_sid: "CAsd1", contact_number: "61412345678", agent_email: "jan@agentivory.com", sales_dialer_number: "61280002222", call_date: "2026-10-20", call_time: "04:00:00",
  campaign: { id: 3, name: "Dentists QLD", type: "Autodial" },
  call_info: { direction: "Outgoing", type: "Outgoing human answered", duration: 95, disposition: "Interested", notes: "", rating: 3, recording: "https://x/rec2" } } });
eq("Sales Dialer: uses call_id and flags the source", [ev.kind, ev.call.providerCallId, ev.call.source, ev.call.callType, ev.call.durationSeconds, ev.call.justcallNumber], ["completed", "9001", "sales_dialer", "answered", 95, "61280002222"]);
ev = parseEvent({ webhook_url: DOC.webhookUrl, type: "sd.call_completed", data: { call_id: 1, call_info: { direction: "Outgoing", type: "Outgoing machine answered" } } });
eq("Sales Dialer: an answering machine counts as voicemail", ev.call.callType, "voicemail");

for (const t of ["call.initiated", "call.incoming", "call.answered", "call.enters_queue", "jc.call_ai_generated", "sd.call_ai_generated", "call.ai_voice_agent", "something.new"]) eq(`event ${t} is ignored`, (parseEvent({ webhook_url: "x", type: t, data: { id: 1 } }) as any).kind, "ignore");
eq("JustCall's URL check (no data) is a validation", parseEvent({ webhook_url: DOC.webhookUrl, type: "call.completed" })?.kind, "validation");
eq("not a JustCall payload at all", [parseEvent(null), parseEvent("x"), parseEvent({}), parseEvent({ data: {} })], [null, null, null, null]);

for (const [raw, want] of [["Answered", "answered"], ["Outgoing human answered", "answered"], ["Outgoing unanswered call", "unanswered"], ["Unanswered", "unanswered"], ["Busy", "unanswered"], ["Missed", "missed"], ["Voicemail", "voicemail"], ["Outgoing machine answered", "voicemail"], ["Outgoing failed call", "failed"], ["Outgoing blocked call", "failed"], ["Abandoned before ringing", "failed"], ["Outgoing cancelled call", "failed"], ["In Progress", "other"], ["", null]] as [string, string | null][]) eq(`call type "${raw}"`, callTypeOf(raw), want);
eq("durations", [formatDuration(130), formatDuration(45), formatDuration(0), formatDuration(3600), formatDuration(null)], ["2m 10s", "45s", "0s", "60m 00s", ""]);
eq("descriptions", [
  describeCall({ direction: "outgoing", call_type: "answered", duration_seconds: 133, conversation_seconds: 130 }),
  describeCall({ direction: "outgoing", call_type: "unanswered", duration_seconds: 20, conversation_seconds: 0 }),
  describeCall({ direction: "incoming", call_type: "missed", duration_seconds: null, conversation_seconds: null }),
  describeCall({ direction: "incoming", call_type: "voicemail", duration_seconds: 22, conversation_seconds: 22 }),
  describeCall({ direction: "incoming", call_type: "voicemail", duration_seconds: 22, conversation_seconds: 0 }),
  describeCall({ direction: "incoming", call_type: "voicemail", duration_seconds: 22, conversation_seconds: null }),
], ["Outgoing · answered · 2m 10s", "Outgoing · no answer", "Incoming · missed", "Incoming · voicemail · 22s", "Incoming · voicemail · 22s", "Incoming · voicemail · 22s"]);

// ── Recording links: only JustCall's own domain, only https
for (const [url, want] of [
  ["https://callingservice.justcall.io/api/create_s3presigned_url.php?id=1", "https://callingservice.justcall.io/api/create_s3presigned_url.php?id=1"],
  ["https://justcall.io/rec/1", "https://justcall.io/rec/1"],
  ["http://callingservice.justcall.io/rec", null], ["https://evil.example/rec", null], ["https://justcall.io.evil.example/rec", null],
  ["https://notjustcall.io/rec", null], ["javascript:alert(1)", null], ["//evil.example", null], ["", null], [null, null], ["not a url", null],
] as [unknown, string | null][]) eq(`recording link ${JSON.stringify(url)}`, safeRecordingUrl(url), want);
eq("a hostile recording link in a webhook is dropped on the way in", (parseEvent(completed({}, { recording: "https://evil.example/phish" })) as any).call.recordingUrl, null);

// ── 4. The click-to-dial link
eq("dial link: + is sent as %2B and the lead rides along as metadata", dialerUrl("+61755551234", LEAD), `https://app.justcall.io/dialer?numbers=%2B61755551234&medium=custom&metadata=${encodeURIComponent(JSON.stringify({ lead_id: LEAD }))}&metadata_type=json`);
eq("dial link without a lead", dialerUrl("+61755551234"), "https://app.justcall.io/dialer?numbers=%2B61755551234");
eq("a number with spaces is encoded", dialerUrl("1300 123 456"), "https://app.justcall.io/dialer?numbers=1300%20123%20456");

// ── 5. The webhook handler against an in-memory database
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
        const row = { id: `${this.t}-${++n}`, created_at: new Date(2026, 9, 20, 3, n).toISOString(), received_at: new Date().toISOString(), ...this.payload };
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

const SECRET = DOC.secret;
const URL_ = DOC.webhookUrl;
const TS = "2026-10-20 14:15:00";
const NOW = Date.UTC(2026, 9, 20, 3, 15, 0);
function signed(body: any, over: { secret?: string; type?: string; ts?: string; version?: string | null; sig?: string | null } = {}) {
  const b = { webhook_url: URL_, ...body };
  const ts = over.ts ?? TS;
  const sig = over.sig === undefined ? expectedSignature({ secret: over.secret ?? SECRET, webhookUrl: URL_, type: over.type ?? b.type, timestamp: ts }) : over.sig;
  return { rawBody: JSON.stringify(b), headers: { signature: sig, version: over.version === undefined ? "v1" : over.version, timestamp: ts }, secret: SECRET, now: NOW };
}
const lead = (id: string, e164: string, over: Row = {}) => ({ id, phone_e164: e164, status: "new", updated_at: "2026-10-19T00:00:00Z", ...over });

(async () => {
  // validation + unsigned + misconfigured
  let db = makeDb({ call_leads: [lead(LEAD, "+61755551234")] });
  let r = await handleWebhook(db, signed({ type: "call.completed" }));
  eq("JustCall's URL-saving check gets a 200", [r.status, r.json.validated], [200, true]);
  r = await handleWebhook(db, signed(completed(), { sig: "deadbeef" }));
  eq("a bad signature is refused (401) and nothing is saved", [r.status, (db.tables.call_activity ?? []).length], [401, 0]);
  eq("...and the refusal is logged for the settings screen", db.tables.justcall_events.at(-1).outcome, "rejected");
  r = await handleWebhook(db, { ...signed(completed()), headers: { signature: null, version: "v1", timestamp: TS } });
  eq("no signature header: 401", r.status, 401);
  r = await handleWebhook(db, { ...signed(completed()), secret: "a-different-secret" });
  eq("our secret doesn't match JustCall's: 401", r.status, 401);
  r = await handleWebhook(db, signed(completed(), { version: "v2" }));
  eq("an unknown signature version is refused", r.status, 401);
  r = await handleWebhook(db, signed(completed(), { ts: "2025-01-01 00:00:00" }));
  eq("a replayed old request is refused", r.status, 401);
  r = await handleWebhook(db, { ...signed(completed()), secret: undefined });
  eq("JUSTCALL_API_SECRET not set: 503 (JustCall will retry), nothing saved", [r.status, (db.tables.call_activity ?? []).length], [503, 0]);
  r = await handleWebhook(db, { ...signed(completed()), rawBody: "not json" });
  eq("junk body: 400", r.status, 400);
  r = await handleWebhook(db, signed({ type: "call.initiated", data: { id: null, call_sid: "CA1" } }));
  eq("an event we don't use: 200 and nothing saved", [r.status, r.json.ignored, (db.tables.call_activity ?? []).length], [200, "call.initiated", 0]);

  // a normal call from the CRM's dialer link
  r = await handleWebhook(db, signed(completed()));
  const row = db.tables.call_activity[0];
  eq("outgoing call saved and matched to the lead by the id on the dialer link", [r.status, r.json.matched, row.lead_id, row.direction, row.call_type, row.agent_email], [200, true, LEAD, "outgoing", "answered", "jan@agentivory.com"]);
  eq("...with its length, time and recording", [row.duration_seconds, row.conversation_seconds, row.started_at, row.recording_url], [133, 130, "2026-10-20T03:14:13.000Z", "https://callingservice.justcall.io/rec?id=1"]);
  eq("...and logged as processed", db.tables.justcall_events.at(-1).outcome, "processed");

  // the same event twice
  r = await handleWebhook(db, signed(completed()));
  eq("JustCall sending it again doesn't duplicate (still one row)", [r.status, db.tables.call_activity.length], [200, 1]);

  // call.updated brings the disposition and notes; must not wipe the rest
  r = await handleWebhook(db, signed({ type: "call.updated", metadata: {}, data: { id: 501, call_sid: "CA123", call_info: { type: "Answered", disposition: "Sales: Lead", notes: "Wants a demo Tuesday", rating: "5" } } }));
  const after = db.tables.call_activity[0];
  eq("updated adds disposition, notes and rating", [after.disposition, after.notes, after.rating], ["Sales: Lead", "Wants a demo Tuesday", 5]);
  eq("...without wiping what the first event gave us", [after.duration_seconds, after.recording_url, after.contact_e164, after.lead_id, after.agent_email, after.started_at], [133, "https://callingservice.justcall.io/rec?id=1", "+61755551234", LEAD, "jan@agentivory.com", "2026-10-20T03:14:13.000Z"]);
  eq("...and still just one row", db.tables.call_activity.length, 1);

  // updated BEFORE completed (events can arrive out of order)
  db = makeDb({ call_leads: [lead(LEAD, "+61755551234")] });
  await handleWebhook(db, signed({ type: "call.updated", metadata: {}, data: { id: 700, call_sid: "CA700", call_info: { disposition: "Not interested" } } }));
  eq("updated arriving first creates a partial row", [db.tables.call_activity.length, db.tables.call_activity[0].disposition, db.tables.call_activity[0].lead_id], [1, "Not interested", null]);
  await handleWebhook(db, signed(completed({ id: 700, call_sid: "CA700" }, { disposition: "" })));
  eq("then completed fills it in, keeps the disposition, and finds the lead", [db.tables.call_activity.length, db.tables.call_activity[0].disposition, db.tables.call_activity[0].duration_seconds, db.tables.call_activity[0].lead_id], [1, "Not interested", 133, LEAD]);

  // matching by number when there's no metadata (a call placed from the JustCall app directly)
  db = makeDb({ call_leads: [lead("A", "+61755551234", { updated_at: "2026-10-10T00:00:00Z" }), lead("B", "+61755551234", { updated_at: "2026-10-18T00:00:00Z" }), lead("C", "+61299990000")] });
  r = await handleWebhook(db, signed({ ...completed(), metadata: {} }));
  eq("no dialer metadata: matched by phone number, the most recently touched lead wins", [r.json.matched, db.tables.call_activity[0].lead_id], [true, "B"]);
  // a stale/unknown id in the metadata falls back to the number
  db = makeDb({ call_leads: [lead("A", "+61755551234")] });
  r = await handleWebhook(db, signed({ ...completed(), metadata: { lead_id: "11111111-1111-4111-8111-111111111111" } }));
  eq("a lead id that no longer exists falls back to the number", db.tables.call_activity[0].lead_id, "A");
  // the hint wins over the number
  db = makeDb({ call_leads: [lead(LEAD, "+61755551234", { updated_at: "2026-10-01T00:00:00Z" }), lead("NEWER", "+61755551234", { updated_at: "2026-10-19T00:00:00Z" })] });
  await handleWebhook(db, signed(completed()));
  eq("the lead on the dialer link beats a newer lead with the same number (group practices share a line)", db.tables.call_activity[0].lead_id, LEAD);

  // unmatched, incoming, voicemail
  db = makeDb({ call_leads: [lead("X", "+61299990000")] });
  r = await handleWebhook(db, signed({ ...completed(), metadata: {} }));
  eq("a call to a number we don't have is saved, unmatched, and logged", [r.status, r.json.matched, db.tables.call_activity[0].lead_id, db.tables.justcall_events.at(-1).outcome], [200, false, null, "unmatched"]);
  eq("...with a helpful reason", /No lead has the number \+61755551234/.test(db.tables.justcall_events.at(-1).detail), true);
  db = makeDb({ call_leads: [lead("A", "+61755551234")] });
  await handleWebhook(db, signed(completed({ id: 800, call_sid: "CA800" }, { direction: "Incoming", type: "Missed" })));
  eq("a missed incoming call (a clinic ringing back) lands on the lead", [db.tables.call_activity[0].direction, db.tables.call_activity[0].call_type, db.tables.call_activity[0].lead_id], ["incoming", "missed", "A"]);

  // database trouble -> 500 so JustCall retries; nothing half-saved
  db = makeDb({ call_leads: [lead(LEAD, "+61755551234")] }, { failInsertOn: "call_activity" });
  r = await handleWebhook(db, signed(completed()));
  eq("a database failure answers 500 (JustCall retries up to 5 times)", [r.status, (db.tables.call_activity ?? []).length], [500, 0]);
  eq("...and says so in the log", db.tables.justcall_events.at(-1).outcome, "error");

  // what the screens read
  db = makeDb({ call_activity: [
    { id: "1", lead_id: "L", started_at: "2026-10-20T01:00:00Z", call_type: "answered", direction: "outgoing", created_at: "x" },
    { id: "2", lead_id: "L", started_at: "2026-10-20T03:00:00Z", call_type: "missed", direction: "incoming", created_at: "x" },
    { id: "3", lead_id: "OTHER", started_at: "2026-10-20T04:00:00Z", call_type: "answered", direction: "outgoing", created_at: "x" } ] });
  eq("a lead's calls are newest first and only that lead's", (await fetchLeadCalls(db, "L")).map((c) => c.id), ["2", "1"]);
  eq("before the JustCall migration: no calls, no crash", (await fetchLeadCalls({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "42P01", message: "does not exist" } }) }) }) }) }) } as any, "L")).length, 0);
  db = makeDb({ justcall_events: [{ id: "e1", received_at: "2026-10-20T02:00:00Z", event_type: "call.completed", outcome: "processed" }, { id: "e2", received_at: "2026-10-20T03:00:00Z", event_type: "call.updated", outcome: "unmatched", detail: "No lead" }], call_activity: [{ id: "c1", created_at: new Date(NOW - 3600 * 1000).toISOString() }, { id: "c2", created_at: new Date(NOW - 48 * 3600 * 1000).toISOString() }] });
  const st = await loadJustCallStatus(db, { NEXT_PUBLIC_JUSTCALL_DIALER: "true", JUSTCALL_API_SECRET: "s", JUSTCALL_API_KEY: "k" } as any, new Date(NOW));
  eq("status: flags, last event, calls in the last 24h, newest event first", [st.dialerEnabled, st.secretConfigured, st.apiKeyConfigured, st.lastEventAt, st.calls24h, st.events.map((e) => e.id)], [true, true, true, "2026-10-20T03:00:00Z", 1, ["e2", "e1"]]);
  const st2 = await loadJustCallStatus(db, {} as any, new Date(NOW));
  eq("status: nothing configured", [st2.dialerEnabled, st2.secretConfigured, st2.apiKeyConfigured], [false, false, false]);
  eq("status: the API key alone isn't enough without the secret", (await loadJustCallStatus(db, { JUSTCALL_API_KEY: "k" } as any, new Date(NOW))).apiKeyConfigured, false);
  const st3 = await loadJustCallStatus({ from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }) } as any, {} as any, new Date(NOW));
  eq("status: before the migration -> setupNeeded", st3.setupNeeded, true);

  console.log(`\n${passes} passed, ${fails} failed`);
})();
