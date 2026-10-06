/**
 * Invoice upload — pull the few fields we need out of a PDF's text.
 *
 * Pure functions, no I/O, so it's testable on its own. Tuned to the
 * Agent Ivory invoice template (IVORY-<client><n>, "INVOICE DATE",
 * "Total due") but with fallbacks for other layouts. Everything it
 * returns is only a PRE-FILL: the upload form always shows the values
 * for a human to confirm before anything is saved.
 *
 * Deliberately returns only these fields — never the raw text, which
 * contains bank details we don't want travelling to the browser.
 */

export type InvoiceKind = "setup" | "retainer" | "other";

export type ParsedInvoice = {
  invoice_number: string | null;
  issued_on:      string | null;   // YYYY-MM-DD
  amount_aud:     number | null;   // total due
  kind:           InvoiceKind;
  /** Does the PDF mention the client we're uploading it to? null = can't tell. */
  client_match:   boolean | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function toIso(y: number, m: number, d: number): string | null {
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseWrittenDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return toIso(Number(m[3]), Number(month), Number(m[1]));
}

function parseNumericDate(text: string): string | null {
  // Australian order: dd/mm/yyyy
  const m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (!m) return null;
  return toIso(Number(m[3]), Number(m[2]), Number(m[1]));
}

function parseInvoiceNumber(text: string): string | null {
  const ivory = text.match(/\b(IVORY-[A-Z0-9]+)\b/i);
  if (ivory) return ivory[1].toUpperCase();
  const generic = text.match(/invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  return generic ? generic[1].toUpperCase() : null;
}

function parseDate(text: string): string | null {
  const labelled = text.match(/INVOICE\s+DATE\s*[:\-]?\s*([^\n]{0,40})/i);
  if (labelled) {
    const d = parseWrittenDate(labelled[1]) ?? parseNumericDate(labelled[1]);
    if (d) return d;
  }
  return parseWrittenDate(text) ?? parseNumericDate(text);
}

function parseAmount(text: string): number | null {
  const patterns = [
    /Total\s+due\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\b(?:Amount|Balance)\s+due\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bTotal\b\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i,   // \b keeps "Subtotal" out
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function guessKind(text: string): InvoiceKind {
  if (/upfront|set-?up/i.test(text)) return "setup";
  if (/retainer|monthly/i.test(text)) return "retainer";
  return "other";
}

const NAME_STOPWORDS = new Set(["pty", "ltd", "the", "and", "inc", "limited"]);

function matchesClient(text: string, clientName?: string | null): boolean | null {
  if (!clientName) return null;
  const words = clientName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w));
  if (words.length === 0) return null;
  const haystack = text.toLowerCase();
  const hits = words.filter((w) => haystack.includes(w)).length;
  return hits / words.length >= 0.6;
}

export function parseInvoiceText(text: string, clientName?: string | null): ParsedInvoice {
  return {
    invoice_number: parseInvoiceNumber(text),
    issued_on:      parseDate(text),
    amount_aud:     parseAmount(text),
    kind:           guessKind(text),
    client_match:   matchesClient(text, clientName),
  };
}
