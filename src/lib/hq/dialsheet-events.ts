import type { SupabaseClient } from "@supabase/supabase-js";
import { checkSignature, parseEvent, secretsFrom, type CallRecord } from "./dialsheet";

/**
 * Receiving DialSheet webhooks.
 *
 *   DialSheet -> POST /api/dialsheet/webhook -> handleWebhook -> call_activity
 *
 * Rules:
 *  - Verify the signature first. Nothing is written for an unsigned request.
 *  - DialSheet only sends `call.completed`, once per call, a couple of minutes after the call ends
 *    (up to 20 minutes for answered calls, which wait for the AI summary).
 *  - Answer 2xx for anything valid (including events we don't use). Anything else is retried, and an
 *    endpoint that fails every retry on 10 calls in a row is switched off by DialSheet, so a request
 *    we refuse for a good reason (bad signature) is the only 4xx, and a database failure answers 500.
 *  - Delivery is "at least once and not in order", so a call is merged into whatever we already have.
 *  - A call is attached to a lead by its phone number. DialSheet has no way to carry our lead id
 *    through a call, so when several leads share a number the one whose business name matches wins,
 *    else the one touched most recently.
 */

export type WebhookResult = { status: number; json: Record<string, unknown> };

const reply = (status: number, json: Record<string, unknown>): WebhookResult => ({ status, json });

type Row = Record<string, unknown>;

/** What goes into call_activity for a call. */
function toRow(c: CallRecord, leadId: string | null): Row {
  return {
    provider: "dialsheet",
    provider_call_id: c.providerCallId,
    lead_id: leadId,
    source: "dialsheet",
    direction: c.direction,
    call_type: c.callType,
    raw_type: c.rawType,
    contact_number: c.contactNumber,
    contact_e164: c.contactE164,
    started_at: c.startedAt,
    duration_seconds: c.durationSeconds,
    disposition: c.disposition,
    notes: c.notes,
    summary: c.summary,
    next_steps: c.nextSteps,
    recording_url: c.recordingUrl,
  };
}

/** New values win, but a field the new event doesn't carry never wipes one we already have. */
export function mergeRows(existing: Row | null, incoming: Row): Row {
  if (!existing) return incoming;
  const out: Row = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

const plain = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The lead a call is for: same number, preferring the one whose business name matches, else the newest. */
async function findLead(admin: SupabaseClient, e164: string | null, names: string[]): Promise<string | null> {
  if (!e164) return null;
  const { data } = await admin
    .from("call_leads")
    .select("id, business_name")
    .eq("phone_e164", e164)
    .order("updated_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as { id: string; business_name: string | null }[];
  if (rows.length === 0) return null;
  const wanted = names.map(plain).filter(Boolean);
  const named = wanted.length ? rows.find((r) => wanted.includes(plain(r.business_name))) : undefined;
  return (named ?? rows[0]).id;
}

async function log(
  admin: SupabaseClient,
  entry: { event_type?: string | null; provider_call_id?: string | null; outcome: "processed" | "unmatched" | "ignored" | "rejected" | "error"; lead_id?: string | null; detail?: string | null },
) {
  try { await admin.from("dialsheet_events").insert(entry); } catch { /* the log is for troubleshooting only */ }
}

/** Save a finished call. Throws on a database failure so the caller can answer 500. */
export async function recordCall(admin: SupabaseClient, call: CallRecord): Promise<{ id: string; leadId: string | null; created: boolean }> {
  const { data: existing, error } = await admin.from("call_activity").select("*").eq("provider", "dialsheet").eq("provider_call_id", call.providerCallId).maybeSingle();
  if (error) throw new Error(error.message);

  const merged = mergeRows((existing as Row | null) ?? null, toRow(call, null));
  let leadId = (existing?.lead_id as string | null | undefined) ?? null;
  if (!leadId) leadId = await findLead(admin, (merged.contact_e164 as string | null) ?? call.contactE164, call.leadNames);
  merged.lead_id = leadId;

  if (existing) {
    const { id: _id, created_at: _c, updated_at: _u, ...patch } = merged;
    const { error: upErr } = await admin.from("call_activity").update(patch).eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    return { id: existing.id as string, leadId, created: false };
  }
  const { data: made, error: inErr } = await admin.from("call_activity").insert(merged).select("id").single();
  if (inErr || !made) throw new Error(inErr?.message ?? "insert failed");
  return { id: made.id as string, leadId, created: true };
}

const WHY_REJECTED: Record<string, string> = {
  missing: "No signature header (not from DialSheet, or the secret isn't being sent).",
  malformed: "The signature header wasn't in the expected form.",
  mismatch: "Signature didn't match: the signing secret in Vercel isn't this webhook's secret, or the request isn't from DialSheet.",
  stale: "The signature was too old.",
};

export async function handleWebhook(
  admin: SupabaseClient,
  input: {
    rawBody: string;
    /** The X-DialSheet-Signature header. */
    signature: string | null | undefined;
    /** DIALSHEET_WEBHOOK_SECRET: the webhook's signing secret (several may be listed). */
    secret: string | undefined;
    now?: number;
  },
): Promise<WebhookResult> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return reply(400, { error: "Body must be valid JSON" });
  }

  const secrets = secretsFrom(input.secret);
  if (secrets.length === 0) {
    return reply(503, { error: "DialSheet isn't set up on this CRM yet (DIALSHEET_WEBHOOK_SECRET is missing)." });
  }

  const check = checkSignature({ secrets, header: input.signature, rawBody: input.rawBody, now: input.now });
  if (!check.ok) {
    await log(admin, { event_type: typeof body.type === "string" ? body.type : null, outcome: "rejected", detail: WHY_REJECTED[check.reason] });
    return reply(401, { error: "Signature check failed." });
  }

  const event = parseEvent(body);
  if (!event) return reply(400, { error: "Not a DialSheet event." });
  if (event.kind === "test") {
    await log(admin, { event_type: "call.completed", outcome: "ignored", detail: "Test event from DialSheet. Nothing was saved." });
    return reply(200, { ok: true, test: true });
  }
  if (event.kind === "ignore") {
    await log(admin, { event_type: event.type, outcome: "ignored", detail: event.why ?? "An event the CRM doesn't use." });
    return reply(200, { ok: true, ignored: event.type });
  }

  try {
    const saved = await recordCall(admin, event.call);
    await log(admin, {
      event_type: event.type,
      provider_call_id: event.call.providerCallId,
      outcome: saved.leadId ? "processed" : "unmatched",
      lead_id: saved.leadId,
      detail: saved.leadId ? null : `No lead has the number ${event.call.contactE164 ?? event.call.contactNumber ?? "(none)"}.`,
    });
    return reply(200, { ok: true, call: saved.id, matched: !!saved.leadId });
  } catch (e) {
    await log(admin, { event_type: event.type, provider_call_id: event.call.providerCallId, outcome: "error", detail: e instanceof Error ? e.message : "unknown error" });
    return reply(500, { error: "Couldn't save the call. DialSheet will retry." });
  }
}

/* ── For the screens ─────────────────────────────────────────────────────── */

export type CallActivity = {
  id: string;
  lead_id: string | null;
  direction: "outgoing" | "incoming" | null;
  call_type: "answered" | "unanswered" | "missed" | "voicemail" | "failed" | "other" | null;
  started_at: string | null;
  duration_seconds: number | null;
  disposition: string | null;
  notes: string | null;
  summary: string | null;
  next_steps: string | null;
  recording_url: string | null;
  created_at: string;
};

const ACTIVITY_COLUMNS =
  "id, lead_id, direction, call_type, started_at, duration_seconds, disposition, notes, summary, next_steps, recording_url, created_at";

/** A lead's calls, newest first. Empty (not an error) before the DialSheet migration is run. */
export async function fetchLeadCalls(supabase: SupabaseClient, leadId: string): Promise<CallActivity[]> {
  const { data, error } = await supabase
    .from("call_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as CallActivity[];
}

export type DialSheetStatus = {
  /** DIALSHEET_WEBHOOK_SECRET is set, so webhooks can be verified. */
  secretConfigured: boolean;
  setupNeeded: boolean;
  calls24h: number;
  /** The last time DialSheet reached us with a request we accepted (a real call or its "Send test"). */
  lastEventAt: string | null;
  events: { id: string; received_at: string; event_type: string | null; outcome: string; detail: string | null }[];
};

export async function loadDialSheetStatus(admin: SupabaseClient, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<DialSheetStatus> {
  const secretConfigured = secretsFrom(env.DIALSHEET_WEBHOOK_SECRET).length > 0;
  const { data: events, error } = await admin
    .from("dialsheet_events")
    .select("id, received_at, event_type, outcome, detail")
    .order("received_at", { ascending: false })
    .limit(15);
  if (error) return { secretConfigured, setupNeeded: true, calls24h: 0, lastEventAt: null, events: [] };

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await admin.from("call_activity").select("id").gte("created_at", since).limit(1000);
  const list = (events ?? []) as DialSheetStatus["events"];
  return {
    secretConfigured,
    setupNeeded: false,
    calls24h: recent?.length ?? 0,
    lastEventAt: list.find((e) => e.outcome !== "rejected")?.received_at ?? null,
    events: list,
  };
}
