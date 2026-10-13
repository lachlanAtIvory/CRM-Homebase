/**
 * Phone numbers for the call list.
 *
 * Scraped numbers arrive in every format ("(02) 9953 1234", "02 9953 1234",
 * "+61 2 9953 1234", "0412345678"). The caller is offshore, so what we copy
 * for the dialer is international format (+61…), which works from any
 * country. Numbers that can't be dialled internationally (1300/1800/13xx)
 * or that don't parse are copied as the digits as scraped.
 */

export type ParsedPhone = {
  /** Readable form shown on screen. */
  display: string;
  /** "+61299531234" when it parses as an Australian number (or valid international), else null. */
  e164: string | null;
  /** What the Copy button puts on the clipboard. */
  copy: string;
  /** False when the number looks wrong and the caller should double-check it. */
  ok: boolean;
};

const EMPTY: ParsedPhone = { display: "", e164: null, copy: "", ok: false };

/** Pretty-print a 9-digit Australian national number (no leading 0). */
function formatNational(n: string): string {
  if (n[0] === "4") return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  return `(0${n[0]}) ${n.slice(1, 5)} ${n.slice(5)}`;
}

export function parsePhone(raw: string | null | undefined): ParsedPhone {
  const original = (raw ?? "").trim();
  if (!original) return EMPTY;

  // "+61 (0)2 …" — the (0) is a trunk prefix that must not be dialled.
  const cleaned = original.replace(/\(0\)/g, "");
  const international = cleaned.startsWith("+") || cleaned.startsWith("0011") || /^00[1-9]/.test(cleaned);
  let digits = cleaned.replace(/\D/g, "");
  if (cleaned.startsWith("0011")) digits = digits.slice(4);
  else if (/^00[1-9]/.test(cleaned)) digits = digits.slice(2);

  // 1300 / 1800 / 13xxxx numbers only work inside Australia.
  if (/^1[38]00\d{6}$/.test(digits) || /^13\d{4}$/.test(digits)) {
    return { display: digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`, e164: null, copy: digits, ok: true };
  }

  let national: string | null = null;
  if (international) {
    if (digits.startsWith("61")) national = digits.slice(2);
    else if (digits.length >= 8 && digits.length <= 15) {
      // A genuine non-Australian number: keep as international.
      return { display: original, e164: `+${digits}`, copy: `+${digits}`, ok: true };
    }
  } else if (digits.startsWith("61") && digits.length === 11) {
    national = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 10) {
    national = digits.slice(1);
  } else if (digits.length === 9 && /^[2-578]/.test(digits)) {
    national = digits;          // area code present but the leading 0 was dropped
  }

  if (national && /^[2-578]\d{8}$/.test(national)) {
    return { display: formatNational(national), e164: `+61${national}`, copy: `+61${national}`, ok: true };
  }

  // Unparseable (e.g. 8 digits with no area code): hand over what we have, flagged.
  return { display: original, e164: null, copy: digits || original, ok: false };
}
