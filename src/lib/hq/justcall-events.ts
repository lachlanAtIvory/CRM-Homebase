import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEvent, timestampFresh, verifySignature, type CallRecord } from "./justcall";

/**
 * Receiving JustCall webhooks.
 *
 *   JustCall -> POST /api/justcall/webhook -> handleWebhook -> call_activity
 *
 * Rules:
 *  - Verify the signature first. Nothing is written for an unsigned or stale request.
 *  - Answer 200 quickly for anything valid (including events we don't use), because
 *    JustCall only retries on 429 / 5xx. A database failure answers 500 so it retries.
 *  - JustCall can send the same event twice, or `call.updated` before `call.completed`,
 *    so a call is merged into whatever we already have, never blindly overwritten.
 *  - A call is attached to a lead by the lead id we put on the dialer link, else by the
 *    number that was called (the newest lead with that number).
 */

export type WebhookResult = { status: number; json: Record<string, unknown> };

const reply = (status: number, json: Record<string, unknown>): WebhookResult => ({ status, json });

type Row = Record<string, unknown>;

/** What goes into call_activity for a call. */
function toRow(c: CallRecord, leadId: string | null): Row {
  return {
    provider: "justcall",
    provider_call_id: c.providerCallId,
    call_sid: c.callSid,
    lead_id: leadId,
    source: c.source,
    direction: c.direction,
    call_type: c.callType,
    raw_type: c.rawType,
    contact_number: c.contactNumber,
    contact_e164: c.contactE164,
    justcall_number: c.justcallNumber,
    agent_email: c.agentEmail,
    agent_name: c.agentName,
    started_at: c.startedAt,
    duration_seconds: c.durationSeconds,
    conversation_seconds: c.conversationSeconds,
    disposition: c.disposition,
    notes: c.notes,
    rating: c.rating,
    recording_url: c.recordingUrl,
    voicemail_text: c.voicemailText,
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

async function findLead(admin: SupabaseClient, hint: string | null, e164: string | null): Promise<string | null> {
  if (hint) {
    const { data } = await admin.from("call_leads").select("id").eq("id", hint).maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (e164) {
    const { data } = await admin
      .from("call_leads")
      .select("id")
      .eq("phone_e164", e164)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data?.[0]?.id) return data[0].id as string;
  }
  return null;
}

async function log(
  admin: SupabaseClient,
  entry: { event_type?: string | null; provider_call_id?: string | null; outcome: "processed" | "unmatched" | "ignored" | "rejected" | "error"; lead_id?: string | null; detail?: string | null },
) {
  try { await admin.from("justcall_events").insert(entry); } catch { /* the log is for troubleshooting only */ }
}

/** Save a completed or updated call. Throws on a database failure so the caller can answer 500. */
export async function recordCall(admin: SupabaseClient, call: CallRecord): Promise<{ id: string; leadId: string | null; created: boolean }> {
  let { data: existing, error } = await admin.from("call_activity").select("*").eq("provider", "justcall").eq("provider_call_id", call.providerCallId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing && call.callSid) {
    ({ data: existing, error } = await admin.from("call_activity").select("*").eq("provider", "justcall").eq("call_sid", call.callSid).maybeSingle());
    if (error) throw new Error(error.message);
  }

  const merged = mergeRows((existing as Row | null) ?? null, toRow(call, null));
  let leadId = (existing?.lead_id as string | null | undefined) ?? null;
  if (!leadId) leadId = await findLead(admin, call.leadIdHint, (merged.contact_e164 as string | null) ?? call.contactE164);
  merged.lead_id = leadId;
  // Keep the id we first stored this call under, so later events keep finding the same row.
  if (existing) merged.provider_call_id = existing.provider_call_id;

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

export async function handleWebhook(
  admin: SupabaseClient,
  input: {
    rawBody: string;
    headers: { signature?: string | null; version?: string | null; timestamp?: string | null };
    /** The account's API secret (JUSTCALL_API_SECRET). */
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

  if (!input.secret) {
    return reply(503, { error: "JustCall isn't set up on this CRM yet (JUSTCALL_API_SECRET is missing)." });
  }

  const webhookUrl = typeof body.webhook_url === "string" ? body.webhook_url : "";
  const type = typeof body.type === "string" ? body.type : "";
  const { signature, version, timestamp } = input.headers;

  const authentic =
    !!webhookUrl && !!type && !!signature && !!timestamp &&
    (!version || version === "v1") &&
    verifySignature({ secret: input.secret, webhookUrl, type, timestamp, signature }) &&
    timestampFresh(timestamp, input.now);
  if (!authentic) {
    await log(admin, { event_type: type || null, outcome: "rejected", detail: "Signature didn't match (wrong API secret, or not from JustCall)." });
    return reply(401, { error: "Signature check failed." });
  }

  const event = parseEvent(body);
  if (!event) return reply(400, { error: "Not a JustCall event." });
  if (event.kind === "validation") return reply(200, { ok: true, validated: true });
  if (event.kind === "ignore") return reply(200, { ok: true, ignored: event.type });

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
    return reply(500, { error: "Couldn't save the call. JustCall will retry." });
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
  conversation_seconds: number | null;
  agent_name: string | null;
  agent_email: string | null;
  disposition: string | null;
  notes: string | null;
  recording_url: string | null;
  voicemail_text: string | null;
  created_at: string;
};

const ACTIVITY_COLUMNS =
  "id, lead_id, direction, call_type, started_at, duration_seconds, conversation_seconds, agent_name, agent_email, disposition, notes, recording_url, voicemail_text, created_at";

/** A lead's JustCall calls, newest first. Empty (not an error) before the JustCall migration is run. */
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

export type JustCallStatus = {
  /** The Call buttons are switched on (NEXT_PUBLIC_JUSTCALL_DIALER). */
  dialerEnabled: boolean;
  /** JUSTCALL_API_SECRET is set, so webhooks can be verified. */
  secretConfigured: boolean;
  /** JUSTCALL_API_KEY is set, so recordings can be streamed through the CRM. */
  apiKeyConfigured: boolean;
  setupNeeded: boolean;
  calls24h: number;
  lastEventAt: string | null;
  events: { id: string; received_at: string; event_type: string | null; outcome: string; detail: string | null }[];
};

export async function loadJustCallStatus(admin: SupabaseClient, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<JustCallStatus> {
  const base = {
    dialerEnabled: env.NEXT_PUBLIC_JUSTCALL_DIALER === "true",
    secretConfigured: !!env.JUSTCALL_API_SECRET,
    apiKeyConfigured: !!env.JUSTCALL_API_KEY && !!env.JUSTCALL_API_SECRET,
  };
  const { data: events, error } = await admin
    .from("justcall_events")
    .select("id, received_at, event_type, outcome, detail")
    .order("received_at", { ascending: false })
    .limit(15);
  if (error) return { ...base, setupNeeded: true, calls24h: 0, lastEventAt: null, events: [] };

  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await admin.from("call_activity").select("id").gte("created_at", since).limit(1000);
  return {
    ...base,
    setupNeeded: false,
    calls24h: recent?.length ?? 0,
    lastEventAt: (events?.[0]?.received_at as string | undefined) ?? null,
    events: (events ?? []) as JustCallStatus["events"],
  };
}
