import { createHmac, timingSafeEqual } from "node:crypto";
import { parsePhone } from "./phone";
import type { CallType, Direction } from "./call-format";

export { describeCall, formatDuration } from "./call-format";
export type { CallType, Direction } from "./call-format";

/**
 * DialSheet — reading what it tells us.
 *
 * Pure functions (no database, no network) so every rule can be tested.
 * Field names follow DialSheet's API docs (dialsheet.io/docs/api): the
 * `call.completed` webhook and its signature header.
 *
 * DialSheet's docs don't give types or allowed values for most fields (a
 * call's id, its direction, its status, date formats), so everything here is
 * read defensively: a field that isn't what we expect is skipped, never fatal.
 */

/* ── Is this really from DialSheet? ──────────────────────────────────────── */

/**
 * DialSheet signs the raw request body: header `X-DialSheet-Signature: t=<unix seconds>,v1=<hex>`,
 * where v1 is HMAC-SHA256 over `${t}.${rawBody}`, keyed with the endpoint's signing secret
 * (it starts with `whsec_`).
 */
export function expectedSignature(opts: { secret: string; timestamp: string; rawBody: string }): string {
  return createHmac("sha256", opts.secret).update(`${opts.timestamp}.${opts.rawBody}`).digest("hex");
}

/** The signing secrets we accept, from the env var (several can be listed, separated by commas or spaces). */
export function secretsFrom(value: string | undefined | null): string[] {
  return (value ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Whatever is pasted in is used as given. The docs don't say whether the `whsec_` prefix is part of
 * the key, so the same secret without the prefix is tried too. Both come from the one secret, so
 * this lets nobody in who doesn't hold it.
 */
function keyCandidates(secrets: string[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) {
    out.add(s);
    if (s.startsWith("whsec_") && s.length > 6) out.add(s.slice(6));
  }
  return [...out];
}

/**
 * How far from now the request's timestamp may be. DialSheet retries for up to 12 hours and the docs
 * don't say whether a retry is re-signed with a fresh time, so this has to be generous, or a retry
 * would be turned away and the endpoint eventually switched off. The body is signed and calls are
 * de-duplicated by id, so replaying an old request can't do anything new.
 */
export const MAX_SKEW_MS = 36 * 60 * 60 * 1000;

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function checkSignature(opts: { secrets: string[]; header: string | null | undefined; rawBody: string; now?: number }): SignatureCheck {
  const header = (opts.header ?? "").trim();
  if (!header) return { ok: false, reason: "missing" };

  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1" && v) v1.push(v.toLowerCase());
  }
  if (!/^\d{9,12}$/.test(t) || v1.length === 0) return { ok: false, reason: "malformed" };

  const keys = keyCandidates(opts.secrets);
  const matches = keys.some((key) => {
    const want = Buffer.from(expectedSignature({ secret: key, timestamp: t, rawBody: opts.rawBody }), "utf8");
    return v1.some((got) => {
      const have = Buffer.from(got, "utf8");
      return have.length === want.length && timingSafeEqual(have, want);
    });
  });
  if (!matches) return { ok: false, reason: "mismatch" };
  if (Math.abs((opts.now ?? Date.now()) - Number(t) * 1000) > MAX_SKEW_MS) return { ok: false, reason: "stale" };
  return { ok: true };
}

/* ── Phone numbers ───────────────────────────────────────────────────────── */

/**
 * Turn the number as DialSheet holds it ("07 5555 1234", "+61 7 5555 1234", "61755551234"…) into the
 * +E.164 form the leads are matched on, or null if it isn't a usable number. Uses the same parser the
 * Call List used when it stored each lead's number, so the same number always comes out the same.
 */
export function normalizeContactNumber(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!text) return null;
  const parsed = parsePhone(text);
  if (parsed.e164) return parsed.e164;
  if (parsed.ok) return null;                     // 1300 / 1800 / 13xx numbers have no international form
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
}

/* ── Reading a call ──────────────────────────────────────────────────────── */

export type CallRecord = {
  /** DialSheet's id for the call. */
  providerCallId: string;
  direction: Direction | null;
  callType: CallType | null;
  /** DialSheet's status word, kept for reference. */
  rawType: string | null;
  /** The lead's number as DialSheet has it, and in +E.164 form. */
  contactNumber: string | null;
  contactE164: string | null;
  /** The business name(s) DialSheet has on the lead; used to pick between leads that share a number. */
  leadNames: string[];
  /** ISO instant the call started. */
  startedAt: string | null;
  durationSeconds: number | null;
  /** The outcome (DialSheet's own wording, e.g. "interested", "callback"). */
  disposition: string | null;
  /** What was typed in the call's notes. */
  notes: string | null;
  /** DialSheet's AI summary and suggested next steps (only on answered calls). */
  summary: string | null;
  nextSteps: string | null;
  recordingUrl: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const MAX_TEXT = 4000;
const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim().slice(0, MAX_TEXT) || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/** Text, or a list of text lines, as one block of text. */
function textOf(v: unknown): string | null {
  if (Array.isArray(v)) return str(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join("\n"));
  return str(v);
}

/** A recording link is kept only if it's https. */
export function safeRecordingUrl(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  try { return new URL(text).protocol === "https:" ? text : null; } catch { return null; }
}

/** DialSheet's outcome word, whether the call was a real conversation, and its status, as one of our few kinds. */
export function callTypeOf(opts: { disposition?: unknown; isConversation?: unknown; status?: unknown }): CallType | null {
  const status = String(opts.status ?? "").trim().toLowerCase();
  const disposition = String(opts.disposition ?? "").trim().toLowerCase();
  if (/(fail|cancel|error)/.test(status)) return "failed";
  if (disposition.includes("voicemail") || disposition.includes("voice mail")) return "voicemail";
  if (/(no[\s_-]?answer|busy)/.test(disposition) || /(no[\s_-]?answer|busy)/.test(status)) return "unanswered";
  if (opts.isConversation === true) return "answered";
  if (opts.isConversation === false) return "unanswered";
  return status || disposition ? "other" : null;
}

export type ParsedEvent =
  | { kind: "test" }                               // the "Send test" button in DialSheet: made-up data, nothing to save
  | { kind: "ignore"; type: string; why?: string } // an event we don't act on
  | { kind: "completed"; type: string; call: CallRecord };

/** Read a webhook body into something the CRM can act on. Returns null if it isn't a DialSheet payload. */
export function parseEvent(body: unknown): ParsedEvent | null {
  const b = obj(body);
  const type = str(b.type);
  if (!type) return null;
  if (b.test === true) return { kind: "test" };
  if (type.toLowerCase() !== "call.completed") return { kind: "ignore", type };

  const c = obj(obj(b.data).call);
  const providerCallId = str(c.id);
  if (!providerCallId) return { kind: "ignore", type, why: "The call had no id." };

  const lead = obj(c.leads);
  const notes = Array.isArray(c.notes) ? c.notes.map(obj) : [];
  const noteText = notes.map((n) => str(n.content)).filter(Boolean).join("\n");
  const lastOutcome = [...notes].reverse().map((n) => str(n.outcome)).find(Boolean) ?? null;
  const disposition = str(c.disposition) ?? lastOutcome;

  const direction = String(c.direction ?? "").toLowerCase();
  const duration = int(c.duration_seconds);
  const started = iso(c.started_at);
  const ended = iso(c.ended_at);
  const startedAt = started ?? (ended && duration != null ? new Date(Date.parse(ended) - duration * 1000).toISOString() : null) ?? iso(b.created_at);

  const contactNumber = str(lead.phone);
  const call: CallRecord = {
    providerCallId,
    // DialSheet is an outbound dialer: a call with no direction is one Jan placed.
    direction: /^in/.test(direction) ? "incoming" : "outgoing",
    callType: callTypeOf({ disposition, isConversation: c.is_conversation, status: c.status }),
    rawType: str(c.status),
    contactNumber,
    contactE164: normalizeContactNumber(contactNumber),
    leadNames: [str(lead.company), str(lead.name)].filter((x): x is string => !!x),
    startedAt,
    durationSeconds: duration,
    disposition,
    notes: str(noteText),
    summary: textOf(c.ai_summary),
    nextSteps: textOf(c.ai_next_steps),
    recordingUrl: safeRecordingUrl(c.recording_url),
  };
  return { kind: "completed", type, call };
}
