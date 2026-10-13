/**
 * Sydney time helpers.
 *
 * Callbacks and sales calls are always booked in SYDNEY time, whatever
 * timezone the person at the keyboard is in (the cold caller is offshore).
 * A <input type="datetime-local"> gives a wall-clock string like
 * "2026-10-20T14:00" with no zone; `new Date(thatString)` would read it in
 * the browser's zone and book the call hours out. Use sydneyWallToISO.
 */

const TZ = "Australia/Sydney";

/** Sydney's UTC offset, in minutes, at a given instant (handles daylight saving). */
function sydneyOffsetMinutes(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wallAsUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

/**
 * "2026-10-20T14:00" read as a Sydney wall-clock time -> the UTC ISO instant.
 * Returns null if the string isn't a valid date-time.
 */
export function sydneyWallToISO(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local ?? "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asUtc)) return null;
  // The offset depends on the instant we're solving for, so settle it in two passes
  // (the second pass fixes times that sit next to a daylight-saving change).
  let instant = asUtc - sydneyOffsetMinutes(asUtc) * 60000;
  instant = asUtc - sydneyOffsetMinutes(instant) * 60000;
  const out = new Date(instant);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

const sydneyFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "short",
  hour: "numeric", minute: "2-digit", hour12: true,
});

/** "Tue, 20 Oct, 2:00 pm" in Sydney time. */
export function formatSydney(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return sydneyFmt.format(d);
}

/** The same instant in the viewer's own timezone, with the zone name: "Tue 20 Oct, 11:00 am GMT+8". */
export function formatViewerLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(d);
}

/** Whether the viewer's timezone has the same offset as Sydney at this instant (so no second line is needed). */
export function viewerIsOnSydneyTime(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return true;
  return -d.getTimezoneOffset() === sydneyOffsetMinutes(d.getTime());
}

/* ── Quick picks for the callback / booking forms ────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** Sydney's wall clock right now, as the string a datetime-local input uses. */
function sydneyWallNow(now: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

const toLocalString = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** Handy times in Sydney: "In 1 hour" (rounded up to 5 minutes), tomorrow 9:30 am, tomorrow 2:00 pm. */
export function quickTimes(now: Date = new Date()): { label: string; value: string }[] {
  const w = sydneyWallNow(now);
  const wallMs = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const inAnHour = Math.ceil((wallMs + 60 * 60000) / (5 * 60000)) * (5 * 60000);
  const tomorrow = Date.UTC(w.y, w.mo - 1, w.d + 1);
  return [
    { label: "In 1 hour", value: toLocalString(inAnHour) },
    { label: "Tomorrow 9:30 am", value: toLocalString(tomorrow + (9 * 60 + 30) * 60000) },
    { label: "Tomorrow 2:00 pm", value: toLocalString(tomorrow + 14 * 60 * 60000) },
  ];
}
