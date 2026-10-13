/**
 * Call list import — turns text pasted from (or exported from) the scraped
 * Google Sheet into lead rows.
 *
 * Accepts tab-separated text (what you get by copying cells out of Google
 * Sheets) or comma-separated text (File > Download > CSV). Column headers
 * are matched by name, so the sheet doesn't need a fixed layout; anything
 * we don't recognise is kept in `extra` rather than thrown away.
 */

import { parsePhone } from "./phone";
import { guessWebsite, isMissingWebsite, WEBSITE_FROM_KEY } from "./website-guess";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_CHARS = 3_000_000;

/** The fields we store. */
export type LeadField =
  | "business_name" | "phone" | "website" | "email" | "address"
  | "category" | "rating" | "review_count" | "google_maps_url";

export const FIELD_LABEL: Record<LeadField, string> = {
  business_name: "Business name",
  phone: "Phone",
  website: "Website",
  email: "Email",
  address: "Address",
  category: "Category",
  rating: "Google rating",
  review_count: "Review count",
  google_maps_url: "Google Maps link",
};

/** Header text (lower-cased, letters and digits only) -> field. */
const SYNONYMS: Record<LeadField, string[]> = {
  business_name: ["businessname", "name", "title", "company", "companyname", "business", "clinicname", "practicename", "placename"],
  phone: ["phone", "number", "phonenumber", "telephone", "tel", "mobile", "contactnumber", "phone1", "phonenumbers"],
  website: ["website", "url", "site", "websiteurl", "web", "websitelink", "domain"],
  email: ["email", "emailaddress", "emails", "contactemail"],
  address: ["address", "fulladdress", "streetaddress", "location"],
  category: ["category", "categories", "type", "industry", "vertical", "maincategory", "businesstype"],
  rating: ["rating", "googlerating", "stars", "averagerating", "reviewrating"],
  review_count: ["reviews", "reviewcount", "reviewscount", "numberofreviews", "totalreviews", "ratingscount", "googlereviews"],
  google_maps_url: ["googlemapsurl", "mapsurl", "googlemaps", "maps", "mapurl", "googlemapslink", "placeurl", "mapslink", "mapsurl", "googlemapurl"],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ── Parsing ─────────────────────────────────────────────────────────────── */

/**
 * Split delimited text into rows of cells. Handles quoted cells that contain
 * the delimiter, doubled quotes, and line breaks inside quotes, plus a
 * leading BOM and Windows line endings.
 */
export function parseDelimited(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

  // Drop rows that are entirely blank.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ColumnMap = {
  /** header index -> field we recognised */
  fields: Map<number, LeadField>;
  /** header indexes we kept as "extra" */
  extras: number[];
};

/** Work out which column is which from the header row. First match per field wins. */
export function mapHeaders(headers: string[]): ColumnMap {
  const fields = new Map<number, LeadField>();
  const taken = new Set<LeadField>();
  const extras: number[] = [];

  headers.forEach((h, i) => {
    const key = headerKey(h);
    const field = (Object.keys(SYNONYMS) as LeadField[]).find((f) => !taken.has(f) && SYNONYMS[f].includes(key));
    if (field) { fields.set(i, field); taken.add(field); }
    else if (h.trim() !== "") extras.push(i);
  });
  return { fields, extras };
}

/* ── Building leads ──────────────────────────────────────────────────────── */

export type ImportLead = {
  lead_key: string;
  business_name: string;
  phone: string | null;
  phone_e164: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  google_maps_url: string | null;
  extra: Record<string, string>;
};

const MAPS_URL = /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i;
const clean = (s: string | undefined) => (s ?? "").trim();
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lower-cased name with punctuation stripped, for matching the same business across imports. */
export function nameKey(name: string): string {
  return alnum(name);
}

function toRating(v: string): number | null {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}
function toCount(v: string): number | null {
  const n = parseInt(v.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** Stable identity for a lead: Maps link, else phone, else name + address. */
export function leadKey(l: { google_maps_url: string | null; phone_e164: string | null; phone: string | null; business_name: string; address: string | null }): string {
  if (l.google_maps_url) return `maps:${l.google_maps_url.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "")}`;
  const tel = l.phone_e164 ?? (l.phone ? l.phone.replace(/\D/g, "") : "");
  if (tel) return `tel:${tel}`;
  return `name:${alnum(l.business_name)}|${alnum(l.address ?? "")}`;
}

export type ImportParse = {
  /** Header text of each recognised column, with the field it became. */
  recognised: { header: string; field: LeadField }[];
  /** Header text of columns kept as extra info. */
  extraHeaders: string[];
  /** Leads ready to import (duplicates inside the file already removed). */
  leads: ImportLead[];
  totalRows: number;
  skippedNoName: number;
  skippedNoPhone: number;
  duplicatesInFile: number;
  /** Leads that had no website but got one by matching their email or another column to the business name. */
  websitesFound: number;
  /** A few of those, so the person importing can eyeball the matching. */
  websiteSample: { business_name: string; website: string; from: "email" | "column" }[];
  /** Set when the file can't be used at all. */
  error?: string;
};

export function parseLeadText(text: string): ImportParse {
  const base: ImportParse = {
    recognised: [], extraHeaders: [], leads: [],
    totalRows: 0, skippedNoName: 0, skippedNoPhone: 0, duplicatesInFile: 0,
    websitesFound: 0, websiteSample: [],
  };
  if (text.length > MAX_IMPORT_CHARS) {
    return { ...base, error: "That's too much to import in one go. Split it into batches of a few thousand leads." };
  }
  const rows = parseDelimited(text);
  if (rows.length < 2) {
    return { ...base, error: "Paste the header row and at least one lead. The first row must be the column names." };
  }
  const [headers, ...body] = rows;
  const map = mapHeaders(headers);
  const have = new Set(map.fields.values());
  if (!have.has("business_name")) {
    return { ...base, error: `Couldn't find a business name column. Columns found: ${headers.map(clean).filter(Boolean).join(", ")}.` };
  }
  if (!have.has("phone")) {
    return { ...base, error: `Couldn't find a phone column. Columns found: ${headers.map(clean).filter(Boolean).join(", ")}.` };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return { ...base, totalRows: body.length, error: `That's ${body.length.toLocaleString("en-AU")} rows. Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-AU")} at a time.` };
  }

  const recognised = [...map.fields].map(([i, field]) => ({ header: clean(headers[i]), field }));
  const extraHeaders = map.extras.map((i) => clean(headers[i]));
  const seen = new Set<string>();
  const result: ImportParse = { ...base, recognised, extraHeaders, totalRows: body.length };

  for (const cells of body) {
    const v: Partial<Record<LeadField, string>> = {};
    for (const [i, field] of map.fields) v[field] = clean(cells[i]);

    // A "website" cell that is really a Google Maps link belongs in the maps field.
    if (v.website && MAPS_URL.test(v.website)) {
      if (!v.google_maps_url) v.google_maps_url = v.website;
      v.website = "";
    }

    const business_name = v.business_name ?? "";
    if (!business_name) { result.skippedNoName++; continue; }
    const phone = v.phone ?? "";
    if (!phone) { result.skippedNoPhone++; continue; }

    const parsed = parsePhone(phone);
    const extra: Record<string, string> = {};
    for (const i of map.extras) {
      const value = clean(cells[i]);
      if (value) extra[clean(headers[i]).slice(0, 60)] = value.slice(0, 500);
    }

    // No website in the sheet (or a placeholder like "N/A")? Try to work it out from the
    // email domain or another link column, but only if it matches the business name.
    let website = isMissingWebsite(v.website) ? "" : (v.website ?? "");
    let websiteFrom: "email" | "column" | null = null;
    if (!website) {
      const guess = guessWebsite({ business_name, email: v.email, extra });
      if (guess) { website = guess.url; websiteFrom = guess.from; }
    }
    if (websiteFrom) extra[WEBSITE_FROM_KEY] = websiteFrom;

    const lead: ImportLead = {
      lead_key: "",
      business_name: business_name.slice(0, 300),
      phone: phone.slice(0, 60),
      phone_e164: parsed.e164,
      website: website ? website.slice(0, 500) : null,
      email: v.email ? v.email.slice(0, 200) : null,
      address: v.address ? v.address.slice(0, 500) : null,
      category: v.category ? v.category.slice(0, 120) : null,
      rating: v.rating ? toRating(v.rating) : null,
      review_count: v.review_count ? toCount(v.review_count) : null,
      google_maps_url: v.google_maps_url ? v.google_maps_url.slice(0, 1000) : null,
      extra,
    };
    lead.lead_key = leadKey(lead);

    if (seen.has(lead.lead_key)) { result.duplicatesInFile++; continue; }
    seen.add(lead.lead_key);
    result.leads.push(lead);
    if (websiteFrom) {
      result.websitesFound++;
      if (result.websiteSample.length < 5) {
        result.websiteSample.push({ business_name: lead.business_name, website: lead.website!, from: websiteFrom });
      }
    }
  }
  return result;
}
