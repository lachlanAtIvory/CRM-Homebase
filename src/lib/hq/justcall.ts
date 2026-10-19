import { createHmac, timingSafeEqual } from "node:crypto";
import { parsePhone } from "./phone";
import type { CallType, Direction } from "./justcall-format";

export { describeCall, formatDuration } from "./justcall-format";
export type { CallType, Direction } from "./justcall-format";

/**
 * JustCall — reading what it tells us.
 *
 * Pure functions (no database, no network) so every rule can be tested.
 * Field names follow JustCall's developer docs (developer.justcall.io):
 * the call webhooks, the call object, and "Dynamic webhook signatures".
 */

/* ── Is this really from JustCall? ───────────────────────────────────────── */

/**
 * JustCall signs each webhook with HMAC-SHA256, keyed by the account's API
 * secret, over  secret | URL-encoded webhook URL | event type | timestamp
 * (joined with "|"), sent hex-encoded in x-justcall-signature. The body is not
 * part of the signature, so we trust only `webhook_url` and `type` from it for
 * verification, and nothing else is treated as proof of origin.
 */
export function expectedSignature(opts: { secret: string; webhookUrl: string; type: string; timestamp: string }): string {
  const payload = `${opts.secret}|${encodeURIComponent(opts.webhookUrl)}|${opts.type}|${opts.timestamp}`;
  return createHmac("sha256", opts.secret).update(payload).digest("hex");
}

export function verifySignature(opts: {
  secret: string; webhookUrl: string; type: string; timestamp: string; signature: string;
}): boolean {
  if (!opts.secret || !opts.signature || !opts.timestamp) return false;
  const want = Buffer.from(expectedSignature(opts), "utf8");
  const got = Buffer.from(opts.signature.trim().toLowerCase(), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * The request timestamp is "YYYY-MM-DD HH:MM:SS" with no zone given. Whatever zone JustCall
 * means, anything more than ~36 hours from now is stale or forged. Unparseable passes
 * (we can't tell, and the signature already vouches for it).
 */
export const MAX_SKEW_MS = 36 * 60 * 60 * 1000;
export function timestampFresh(timestamp: string, now = Date.now()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(timestamp.trim());
  if (!m) return true;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Math.abs(now - at) <= MAX_SKEW_MS;
}

/* ── Phone numbers ───────────────────────────────────────────────────────── */

/**
 * JustCall sends numbers without a "+", e.g. "61755551234". Turn whatever arrives into
 * the +E.164 form the leads are stored in, or null if it isn't a usable number.
 */
export function normalizeContactNumber(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 8) return null;

  const candidates: string[] = [];
  if (text.startsWith("+")) candidates.push(`+${digits}`);
  else if (digits.startsWith("0") && digits.length === 10) candidates.push(`0${digits.slice(1)}`);   // 0412… / 0755… (Australian national)
  else candidates.push(`+${digits}`);

  for (const c of candidates) {
    const parsed = parsePhone(c);
    if (parsed.e164) return parsed.e164;
  }
  return digits.length <= 15 ? `+${digits}` : null;
}

/* ── Reading a call ──────────────────────────────────────────────────────── */

export type CallRecord = {
  /** JustCall's id for the call (numeric id, else the call_sid). */
  providerCallId: string;
  callSid: string | null;
  source: "justcall" | "sales_dialer";
  direction: Direction | null;
  callType: CallType | null;
  rawType: string | null;
  contactNumber: string | null;
  contactE164: string | null;
  justcallNumber: string | null;
  agentEmail: string | null;
  agentName: string | null;
  /** ISO instant the call started (JustCall sends the date and time in UTC). */
  startedAt: string | null;
  durationSeconds: number | null;
  conversationSeconds: number | null;
  disposition: string | null;
  notes: string | null;
  rating: number | null;
  recordingUrl: string | null;
  voicemailText: string | null;
  /** The lead id we attached to the dialer link when the call was placed from the CRM. */
  leadIdHint: string | null;
};

/** JustCall's wording ("Outgoing human answered", "Unanswered", "Voicemail"…) as one of our few kinds. */
export function callTypeOf(raw: unknown): CallType | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("voicemail") || t.includes("machine")) return "voicemail";
  if (t.includes("unanswered") || t.includes("no answer") || t.includes("busy")) return "unanswered";
  if (t.includes("missed")) return "missed";
  if (/(failed|blocked|restricted|cancel|abandon)/.test(t)) return "failed";
  if (t.includes("answered")) return "answered";
  return "other";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** `metadata` may arrive as an object or as a JSON string; find our lead id inside it. */
function leadIdFrom(metadata: unknown): string | null {
  let m: unknown = metadata;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return null; } }
  const id = obj(m).lead_id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

export type ParsedEvent =
  | { kind: "validation" }                         // JustCall's check when a URL is saved: no call data
  | { kind: "ignore"; type: string }               // an event we don't act on (ringing, queue, AI report…)
  | { kind: "completed" | "updated"; type: string; call: CallRecord };

/** Read a webhook body into something the CRM can act on. Returns null if it isn't a JustCall payload. */
export function parseEvent(body: unknown): ParsedEvent | null {
  const b = obj(body);
  const type = str(b.type);
  if (!type) return null;
  if (b.data === undefined || b.data === null) return { kind: "validation" };

  const t = type.toLowerCase();
  const completed = t === "call.completed" || t === "sd.call_completed" || t.endsWith(".call_completed");
  const updated = t === "call.updated" || t === "sd.call_updated" || t.endsWith(".call_updated");
  if (!completed && !updated) return { kind: "ignore", type };

  const d = obj(b.data);
  const info = obj(d.call_info);
  const dur = obj(d.call_duration);
  const salesDialer = t.startsWith("sd.") || d.sales_dialer_number !== undefined || d.call_id !== undefined;

  // Sales Dialer calls carry `call_id`; JustCall calls carry `id`. Until the call is logged `id` can be null: use the sid.
  const providerCallId = str(d.id) ?? str(d.call_id) ?? str(d.call_sid);
  if (!providerCallId) return { kind: "ignore", type };

  const direction = str(info.direction)?.toLowerCase();
  const date = str(d.call_date), time = str(d.call_time);
  const startedAt = date && time && !Number.isNaN(Date.parse(`${date}T${time}Z`)) ? new Date(`${date}T${time}Z`).toISOString() : null;

  const total = int(dur.total_duration) ?? int(info.duration);
  const contactNumber = str(d.contact_number);

  const call: CallRecord = {
    providerCallId,
    callSid: str(d.call_sid),
    source: salesDialer ? "sales_dialer" : "justcall",
    direction: direction === "outgoing" ? "outgoing" : direction === "incoming" ? "incoming" : null,
    callType: callTypeOf(info.type),
    rawType: str(info.type),
    contactNumber,
    contactE164: normalizeContactNumber(contactNumber),
    justcallNumber: str(d.justcall_number) ?? str(d.sales_dialer_number),
    agentEmail: str(d.agent_email)?.toLowerCase() ?? null,
    agentName: str(d.agent_name),
    startedAt,
    durationSeconds: total,
    conversationSeconds: int(dur.conversation_time) ?? int(info.duration),
    disposition: str(info.disposition),
    notes: str(info.notes),
    rating: int(info.rating),
    recordingUrl: safeRecordingUrl(info.recording),
    voicemailText: str(info.voicemail_transcription),
    leadIdHint: leadIdFrom(b.metadata),
  };
  return { kind: completed ? "completed" : "updated", type, call };
}

/**
 * A recording link is only kept (and only ever followed) if it's an https link on JustCall's own
 * domain. The webhook body isn't covered by JustCall's signature, so a link in it is never trusted blindly.
 */
export function safeRecordingUrl(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  try {
    const u = new URL(text);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "justcall.io" || host.endsWith(".justcall.io")) ? u.toString() : null;
  } catch { return null; }
}
