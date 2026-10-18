/**
 * What time is it where the clinic is?
 *
 * The caller works in Sydney time, but a Queensland clinic is an hour behind
 * Sydney in summer, Western Australia three hours, Adelaide half an hour, and
 * Darwin an hour and a half. Calling at "9 am" is a mistake if it's 6 am there.
 *
 * The state is worked out from the address (state name or abbreviation, then
 * postcode), then from the phone area code where that's unambiguous.
 */

export type AuState = "NSW" | "ACT" | "VIC" | "TAS" | "QLD" | "SA" | "NT" | "WA";

export const STATE_ZONE: Record<AuState, string> = {
  NSW: "Australia/Sydney", ACT: "Australia/Sydney", VIC: "Australia/Melbourne", TAS: "Australia/Hobart",
  QLD: "Australia/Brisbane", SA: "Australia/Adelaide", NT: "Australia/Darwin", WA: "Australia/Perth",
};

const FULL_NAMES: [RegExp, AuState][] = [
  [/new south wales/i, "NSW"], [/australian capital territory/i, "ACT"], [/victoria/i, "VIC"], [/queensland/i, "QLD"],
  [/south australia/i, "SA"], [/western australia/i, "WA"], [/northern territory/i, "NT"], [/tasmania/i, "TAS"],
];

const ABBR = "NSW|ACT|VIC|QLD|TAS|SA|WA|NT";

/** State for an Australian postcode. */
export function stateForPostcode(code: number): AuState | null {
  if ((code >= 2600 && code <= 2618) || (code >= 2900 && code <= 2920) || (code >= 200 && code <= 299)) return "ACT";
  if ((code >= 2000 && code <= 2999) || (code >= 1000 && code <= 1999)) return "NSW";
  if ((code >= 3000 && code <= 3999) || (code >= 8000 && code <= 8999)) return "VIC";
  if ((code >= 4000 && code <= 4999) || (code >= 9000 && code <= 9999)) return "QLD";
  if (code >= 5000 && code <= 5999) return "SA";
  if (code >= 6000 && code <= 6999) return "WA";
  if (code >= 7000 && code <= 7999) return "TAS";
  if (code >= 800 && code <= 999) return "NT";
  return null;
}

export type StateGuess = { state: AuState; how: "address" | "postcode" | "phone" };

export function guessState(address?: string | null, phone?: string | null): StateGuess | null {
  const a = (address ?? "").trim();
  if (a) {
    // "Helensvale QLD 4212" / "Helensvale Qld 4212": the state right before a postcode is the surest sign
    const withCode = [...a.matchAll(new RegExp(`\\b(${ABBR})\\b\\.?,?\\s+\\d{4}\\b`, "gi"))].at(-1);
    if (withCode) return { state: withCode[1].toUpperCase() as AuState, how: "address" };
    // An upper-case abbreviation anywhere (the last one, as the state comes at the end)
    const upper = [...a.matchAll(new RegExp(`\\b(${ABBR})\\b`, "g"))].at(-1);
    if (upper) return { state: upper[1] as AuState, how: "address" };
    for (const [re, st] of FULL_NAMES) if (re.test(a)) return { state: st, how: "address" };
    const code = [...a.matchAll(/\b(\d{4})\b/g)].at(-1);
    if (code) {
      const st = stateForPostcode(Number(code[1]));
      if (st) return { state: st, how: "postcode" };
    }
  }
  // Area codes: only the ones that point to one time zone (08 is WA, SA and NT: too mixed to guess)
  const digits = (phone ?? "").replace(/\D/g, "");
  const national = digits.startsWith("61") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  if (/^07\d{8}$/.test(national)) return { state: "QLD", how: "phone" };
  if (/^02\d{8}$/.test(national)) return { state: "NSW", how: "phone" };
  if (/^03\d{8}$/.test(national)) return { state: "VIC", how: "phone" };
  return null;
}

/** UTC offset of a zone at an instant, in minutes. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Minutes the zone is ahead of Sydney (negative = behind) at an instant. */
export function minutesFromSydney(zone: string, at: Date): number {
  return offsetMinutes(zone, at) - offsetMinutes("Australia/Sydney", at);
}

export function diffLabel(minutes: number): string {
  if (minutes === 0) return "same time as Sydney";
  const abs = Math.abs(minutes);
  const dir = minutes < 0 ? "behind" : "ahead of";
  const hours = abs / 60;
  const amount =
    abs === 30 ? "30 minutes"
    : hours === 1 ? "1 hour"
    : Number.isInteger(hours) ? `${hours} hours`
    : `${Math.floor(hours)}½ hours`;
  return `${amount} ${dir} Sydney`;
}

const clockFmt = (zone: string) => new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });
const dayFmt = (zone: string) => new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" });
const hourFmt = (zone: string) => new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });

const clock = (zone: string, at: Date) => clockFmt(zone).format(at).replace(/\s?(am|pm)$/i, (_, ap) => ` ${String(ap).toLowerCase()}`);

export type ClinicTime = {
  state: AuState;
  how: StateGuess["how"];
  zone: string;
  /** "8:42 am" where the clinic is. */
  clock: string;
  /** "Mon" where the clinic is. */
  day: string;
  /** Minutes ahead of Sydney (negative = behind). */
  diff: number;
  diffLabel: string;
  /** A typical clinic's day: open 8-5 on weekdays. A guide, not a promise. */
  hours: "open" | "after-hours" | "weekend";
  /** One line for the screen. */
  summary: string;
};

export function clinicTime(lead: { address?: string | null; phone?: string | null }, now = new Date()): ClinicTime | null {
  const guess = guessState(lead.address, lead.phone);
  if (!guess) return null;
  const zone = STATE_ZONE[guess.state];
  const diff = minutesFromSydney(zone, now);

  const parts = hourFmt(zone).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  const mins = h * 60 + m;
  const weekend = wd === "Sat" || wd === "Sun";
  const hours: ClinicTime["hours"] = weekend ? "weekend" : mins >= 8 * 60 && mins < 17 * 60 ? "open" : "after-hours";

  const where = guess.how === "phone" ? `${guess.state}?` : guess.state;
  const open = hours === "open" ? "usually open" : hours === "weekend" ? "weekend: many clinics are closed" : "usually closed now";
  const summary = diff === 0
    ? `${clock(zone, now)} ${dayFmt(zone).format(now)} (${where}, same as Sydney) · ${open}`
    : `${clock(zone, now)} ${dayFmt(zone).format(now)} in ${where} (${diffLabel(diff)}) · ${open}`;

  return { state: guess.state, how: guess.how, zone, clock: clock(zone, now), day: dayFmt(zone).format(now), diff, diffLabel: diffLabel(diff), hours, summary };
}

/** What a Sydney booking time is where the clinic is: "8:30 am", or null when it's the same as Sydney. */
export function clinicClockForSlot(lead: { address?: string | null; phone?: string | null }, slotISO: string): { clock: string; state: AuState } | null {
  const guess = guessState(lead.address, lead.phone);
  if (!guess) return null;
  const at = new Date(slotISO);
  if (Number.isNaN(at.getTime())) return null;
  const zone = STATE_ZONE[guess.state];
  if (minutesFromSydney(zone, at) === 0) return null;
  return { clock: clock(zone, at), state: guess.state };
}
