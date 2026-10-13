/**
 * Work out a lead's website from the data we already have.
 *
 * No web lookups. Two sources, in order:
 *   1. the domain in their email address ("hi@breezedental.com.au")
 *   2. a stray link in another sheet column ("Site 2", "Homepage", …)
 *
 * A candidate is only accepted when it cross-checks against the business
 * name: the domain has to contain a distinctive word from the name. So
 * "reception@breezedental.com.au" is accepted for "Breeze Dental
 * Helensvale", while a gmail address, a shared group domain, or a report
 * link that has nothing to do with the name is ignored.
 *
 * The result is a best guess, never verified to be live. The CRM marks it
 * "found from email" so a person knows to treat it that way.
 */

export type WebsiteGuess = {
  /** https://domain (home page only). */
  url: string;
  /** Where it came from. */
  from: "email" | "column";
};

/** Free / ISP mailboxes. An address here says nothing about the business's own site. */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.au", "hotmail.co.uk", "outlook.com", "outlook.com.au",
  "live.com", "live.com.au", "msn.com", "yahoo.com", "yahoo.com.au", "yahoo.co.uk", "ymail.com", "y7mail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "bigpond.com", "bigpond.com.au",
  "bigpond.net.au", "telstra.com", "optusnet.com.au", "tpg.com.au", "iinet.net.au", "internode.on.net",
  "westnet.com.au", "ozemail.com.au", "dodo.com.au", "aussiebb.com.au", "exetel.com.au", "adam.com.au",
  "people.net.au", "hotmail.co.nz", "xtra.co.nz", "gmx.com", "mail.com", "zoho.com", "fastmail.com",
]);

/** Directories, socials and booking platforms: a link to these is never "their website". */
const NOT_A_BUSINESS_SITE = [
  "google.", "goo.gl", "g.page", "facebook.", "fb.com", "instagram.", "linkedin.", "twitter.", "x.com", "youtube.",
  "youtu.be", "tiktok.", "pinterest.", "yelp.", "healthengine.", "hotdoc.", "whitepages.", "yellowpages.", "truelocal.",
  "hipages.", "oneflare.", "localsearch.", "airtasker.", "linktr.ee", "wa.me", "bing.", "yahoo.", "apple.", "wordpress.com",
  "wixsite.com", "business.site", "square.site", "setmore.", "timely.", "cliniko.", "nookal.", "halaxy.", "coreplus.",
  "tidyhq.", "calendly.", "acuityscheduling.", "squarespace.com", "bookings.", "tripadvisor.", "trustpilot.",
];

/** Two-part public suffixes we meet in Australia and New Zealand. */
const TWO_PART_SUFFIXES = new Set([
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au", "co.nz", "org.nz", "net.nz", "co.uk", "org.uk",
]);

/** Words that describe the kind of business or its legal form. They don't identify it. */
const GENERIC_WORDS = new Set([
  "the", "and", "pty", "ltd", "limited", "inc", "company", "clinic", "clinics", "centre", "center", "health", "healthcare",
  "care", "group", "practice", "practices", "dental", "dentist", "dentists", "dentistry", "physio", "physiotherapy",
  "physiotherapist", "physiotherapists", "chiro", "chiropractic", "chiropractor", "chiropractors", "medical", "family",
  "general", "cosmetic", "orthodontics", "orthodontist", "orthodontists", "skin", "laser", "surgery", "studio", "wellness",
  "sports", "sport", "rehab", "rehabilitation", "therapy", "osteo", "osteopath", "osteopathy", "podiatry", "podiatrist",
  "specialist", "specialists", "services", "service", "solutions", "australia", "australian", "doctor", "doctors",
  "smile", "smiles", "teeth", "tooth", "beauty", "aesthetics", "aesthetic", "institute",
]);

const JUNK_WEBSITE = /^(n\/?a|none|null|nil|unknown|-+|\.+|no website|no site|not available|tbc|tba)$/i;

/** True when a cell that should hold a website is really blank or a placeholder. */
export function isMissingWebsite(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v === "" || JUNK_WEBSITE.test(v);
}

/** Lower-case, accents removed ("Créme" -> "creme"). */
const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const alnum = (s: string) => plain(s).replace(/[^a-z0-9]/g, "");

/** The distinctive words in a business name, lower-cased. */
function distinctiveWords(name: string): string[] {
  return plain(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
}

/** "mail.breezedental.com.au" -> { registrable: "breezedental.com.au", label: "breezedental" } */
function splitDomain(host: string): { registrable: string; label: string } | null {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join(".");
  const keep = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (parts.length < keep) return null;
  const registrable = parts.slice(-keep).join(".");
  return { registrable, label: parts[parts.length - keep] };
}

const isBlocked = (host: string) => NOT_A_BUSINESS_SITE.some((b) => host.includes(b));

const GENERIC_BY_LENGTH = [...GENERIC_WORDS].sort((a, b) => b.length - a.length);

/** A domain label with every generic word cut out ("dentalclinic" -> "", "cremedental" -> "creme"). */
function withoutGenericWords(label: string): string {
  let out = label;
  for (const w of GENERIC_BY_LENGTH) out = out.split(w).join("");
  return out;
}

/** Does this domain plausibly belong to this business? */
function domainMatchesName(label: string, name: string): boolean {
  const l = alnum(label);
  if (l.length < 3) return false;
  if (distinctiveWords(name).some((w) => l.includes(alnum(w)))) return true;
  // The whole domain label sits inside the name run together ("bondi smiles" / "bondismiles"),
  // as long as the domain isn't just generic words like "dentalclinic".
  return l.length >= 6 && alnum(name).includes(l) && withoutGenericWords(l).length >= 3;
}

/** Every email address in a cell ("a@x.com; b@y.com"). */
function emailsIn(value: string | null | undefined): string[] {
  return (value ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
}

/** If a cell holds a web address, its host; otherwise null. */
function hostOfUrlish(value: string): string | null {
  const v = value.trim();
  if (!v || /\s/.test(v) || v.includes("@")) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : /^www\./i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(v) ? `https://${v}` : null;
  if (!withProto) return null;
  try {
    const host = new URL(withProto).hostname.toLowerCase();
    return host.includes(".") ? host : null;
  } catch { return null; }
}

export function guessWebsite(lead: {
  business_name: string;
  email?: string | null;
  extra?: Record<string, string> | null;
}): WebsiteGuess | null {
  // 1. Email domain
  for (const address of emailsIn(lead.email)) {
    const host = address.split("@")[1];
    if (!host || FREE_EMAIL_DOMAINS.has(host)) continue;
    const d = splitDomain(host);
    if (!d || isBlocked(d.registrable) || FREE_EMAIL_DOMAINS.has(d.registrable)) continue;
    if (domainMatchesName(d.label, lead.business_name)) return { url: `https://${d.registrable}`, from: "email" };
  }

  // 2. A link sitting in some other column
  for (const [key, value] of Object.entries(lead.extra ?? {})) {
    if (key.startsWith("_")) continue;
    const host = hostOfUrlish(value);
    if (!host || isBlocked(host)) continue;
    const d = splitDomain(host);
    if (!d || !domainMatchesName(d.label, lead.business_name)) continue;
    return { url: `https://${host}`, from: "column" };
  }
  return null;
}

/** Key in `extra` that records where an inferred website came from. Hidden from the UI's "more from the sheet" list. */
export const WEBSITE_FROM_KEY = "_website_from";
