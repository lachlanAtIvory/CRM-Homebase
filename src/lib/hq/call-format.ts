/**
 * How a logged phone call is described on screen. Safe to import in the browser
 * (dialsheet.ts uses Node's crypto for signatures, so it can't be).
 */

export type CallType = "answered" | "unanswered" | "missed" | "voicemail" | "failed" | "other";
export type Direction = "outgoing" | "incoming";

/** "2m 10s" for a length in seconds. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "";
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** One line describing a call for the lead's history. */
export function describeCall(c: { direction: Direction | null; call_type: CallType | null; duration_seconds: number | null }): string {
  const dir = c.direction === "incoming" ? "Incoming" : "Outgoing";
  const kind =
    c.call_type === "answered" ? "answered"
    : c.call_type === "unanswered" ? "no answer"
    : c.call_type === "missed" ? "missed"
    : c.call_type === "voicemail" ? "voicemail"
    : c.call_type === "failed" ? "didn't connect"
    : "call";
  const len = formatDuration(c.duration_seconds);
  return `${dir} · ${kind}${len && (c.call_type === "answered" || c.call_type === "voicemail") ? ` · ${len}` : ""}`;
}
