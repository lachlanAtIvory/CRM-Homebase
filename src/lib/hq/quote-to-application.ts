import { CLINIC_TYPES, CORE, CORE_ORDER, OFFER_KIND, TIER_LABEL, UPSELLS, type Band, type ClinicType, type OfferKind, type QuoteState, type Tier } from "./quote-config";
import { computeQuote, num, upsellAvailable, type Line } from "./quote-math";

/**
 * From a quote to an application.
 *
 * The Quote Builder is where a clinic's requirements are worked out on the
 * sales call; the application is where the build is specified. Pushing a quote
 * to the application copies across what was already decided (which products,
 * how big the clinic is, what practice software it uses, the price), so none
 * of it is typed twice.
 *
 * Pure functions: a QuoteState in, plain data out.
 */

/** The headline of a quote: what was quoted and why, kept with the application. */
export type QuoteSummary = {
  clinic: string;
  clinicType: ClinicType;
  clinicTypeLabel: string;
  tier: Tier;
  tierLabel: string;
  band: Band;
  practitioners: number;
  /** Core channels included (new or already live). */
  channels: number;
  pms: { name: string; integrates: boolean };
  term: "m2m" | "12";
  /** Whether the quote was shown including GST. The totals below are always excluding GST. */
  gst: boolean;
  setupTotal: number;
  monthlyTotal: number;
  setup: Line[];
  monthly: Line[];
  runs: Line[];
  fees: Line[];
  flags: string[];
  /** Core products in the quote. `live` ones are already running at the clinic and aren't part of the build. */
  core: { key: string; label: string; status: "new" | "live" }[];
  /** The add-ons selected (and available for this clinic). */
  upsells: { key: string; label: string }[];
  locations: { name: string; practitioners: number }[];
  offers: { name: string; kind: OfferKind; kindLabel: string }[];
  leadsPerMonth: string;
  notes: string;
};

/** What gets saved on an application when a quote is pushed to it. */
export type QuoteSnapshot = {
  state: QuoteState;
  summary: QuoteSummary;
};

/**
 * The products to build: new core products and the add-ons that apply to this clinic.
 * A core product marked "live" is already running there, so it isn't something to build.
 */
export function productKeysFromQuote(s: QuoteState): string[] {
  const keys: string[] = CORE_ORDER.filter((k) => s.core[k].state === "new");
  for (const u of UPSELLS) {
    if (s.upsells[u.id] && upsellAvailable(u, s)) keys.push(u.id);
  }
  return keys;
}

export function summarizeQuote(s: QuoteState): QuoteSummary {
  const r = computeQuote(s);
  const clinicType = CLINIC_TYPES.find((t) => t.id === s.type);
  return {
    clinic: s.clinic.trim(),
    clinicType: s.type,
    clinicTypeLabel: clinicType?.label ?? s.type,
    tier: r.tier,
    tierLabel: TIER_LABEL[r.tier],
    band: r.band,
    practitioners: Math.max(0, Math.round(num(s.practitioners))),
    channels: r.count,
    pms: { name: s.pmsName.trim(), integrates: r.integrates },
    term: s.term,
    gst: s.gst,
    setupTotal: r.setupTotal,
    monthlyTotal: r.monthlyTotal,
    setup: r.setup,
    monthly: r.monthly,
    runs: r.runs,
    fees: r.fees,
    flags: r.flags,
    core: CORE_ORDER
      .filter((k) => s.core[k].state !== "off")
      .map((k) => ({ key: k, label: CORE[k].label, status: s.core[k].state === "live" ? "live" as const : "new" as const })),
    upsells: UPSELLS
      .filter((u) => s.upsells[u.id] && upsellAvailable(u, s))
      .map((u) => ({ key: u.id, label: u.name })),
    locations: s.locations.map((l) => ({ name: l.name.trim() || "Extra location", practitioners: Math.max(0, Math.round(num(l.practitioners))) })),
    offers: s.core.outbound.state !== "off"
      ? s.offers.map((o) => ({ name: o.name.trim(), kind: o.kind, kindLabel: OFFER_KIND[o.kind] }))
      : [],
    leadsPerMonth: s.leads.trim(),
    notes: s.notes.trim(),
  };
}

export function snapshotOf(s: QuoteState): QuoteSnapshot {
  return { state: s, summary: summarizeQuote(s) };
}

/** The application columns a pushed quote sets. */
export type ApplicationPatch = {
  selected_products: string[];
  /** One-off setup, excluding GST. */
  upfront_total_aud: number;
  /** Monthly, excluding GST. */
  monthly_total_aud: number;
  quote_snapshot: QuoteSnapshot;
  quote_pushed_at: string;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function applicationPatchFromQuote(s: QuoteState, now: Date): ApplicationPatch {
  const snapshot = snapshotOf(s);
  return {
    selected_products: productKeysFromQuote(s),
    upfront_total_aud: cents(snapshot.summary.setupTotal),
    monthly_total_aud: cents(snapshot.summary.monthlyTotal),
    quote_snapshot: snapshot,
    quote_pushed_at: now.toISOString(),
  };
}

/** The snapshot stored on an application, if it's one we wrote (anything else is treated as none). */
export function readSnapshot(raw: unknown): QuoteSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!o.summary || typeof o.summary !== "object" || !o.state || typeof o.state !== "object") return null;
  return raw as QuoteSnapshot;
}
