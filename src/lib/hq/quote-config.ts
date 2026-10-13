/**
 * Quote Builder — pricing configuration (v2, Oct 2026 offerings).
 *
 * Every price and rule the quote engine uses lives here; the maths itself is
 * in quote-math.ts. Ported from the standalone "Agent Ivory quote builder"
 * and checked against it number for number.
 *
 * Pricing model in one paragraph: a clinic is sized into a tier (Solo /
 * Practice / Group) by practitioner count and a band (Standard / High-value)
 * by clinic type. Setup is charged per tier; each extra core product is half
 * price to set up. Monthly comes from a tier x band matrix, with 10% / 15%
 * off for 2 / 3 channels. Extra locations are half-price setup and 75% of
 * the monthly. Upsells are priced by the main location's tier.
 */

export type ClinicType = "physio" | "chiro" | "gendental" | "cosdental" | "ortho" | "cosskin";
export type Band = "standard" | "high";
export type Tier = "solo" | "practice" | "group";
export type CoreKey = "inbound" | "dm" | "outbound";
export type CoreStatus = "off" | "new" | "live";
export type OfferKind = "low" | "mid" | "high";
export type DiscountReason = "none" | "term" | "upfront" | "casestudy";
export type UpsellId =
  | "treatment" | "nurture" | "backfill" | "recall" | "coaching"
  | "reactivation" | "existing" | "guru" | "intake" | "review";

/** Prices indexed [solo, practice, group]. */
export type Triple = [number, number, number];

export const CLINIC_TYPES: { id: ClinicType; label: string; band: Band }[] = [
  { id: "physio",    label: "Physio",          band: "standard" },
  { id: "chiro",     label: "Chiro",           band: "standard" },
  { id: "gendental", label: "General dental",  band: "standard" },
  { id: "cosdental", label: "Cosmetic dental", band: "high" },
  { id: "ortho",     label: "Orthodontics",    band: "high" },
  { id: "cosskin",   label: "Cosmetic skin",   band: "high" },
];

export const TIER_LABEL: Record<Tier, string> = { solo: "Solo", practice: "Practice", group: "Group" };
export const TIER_INDEX: Record<Tier, 0 | 1 | 2> = { solo: 0, practice: 1, group: 2 };

/** Practitioner counts that make a clinic Solo (<= 2), Practice (<= 6), else Group. */
export const TIER_MAX_PRACTITIONERS = { solo: 2, practice: 6 } as const;

/** One-off setup for the first core product, by tier. */
export const SETUP: Record<Tier, number> = { solo: 1750, practice: 2000, group: 3500 };

/** Lowest setup that still clears the $150 an hour floor, by tier. */
export const FLOOR_SETUP: Record<Tier, number> = { solo: 1500, practice: 1875, group: 3000 };
export const HOURLY_FLOOR = 150;

/** Recovered appointments a month for one location, before extra channels. */
export const BASE_APPTS: Record<Tier, number> = { solo: 20, practice: 40, group: 60 };
/** Each extra channel adds this share of the base recovered appointments. */
export const EXTRA_CHANNEL_APPT_LIFT = 0.5;

/** Value of one recovered appointment, by band, when not overridden. */
export const DEFAULT_APPT_VALUE: Record<Band, number> = { standard: 200, high: 400 };

export const CORE_ORDER: CoreKey[] = ["inbound", "dm", "outbound"];

export const CORE: Record<CoreKey, {
  label: string;
  desc: string;
  monthly: Record<Band, Record<Tier, number>>;
}> = {
  inbound: {
    label: "Inbound calls",
    desc: "Answers enquiry calls in seconds and books new patients.",
    monthly: {
      standard: { solo: 390, practice: 690,  group: 990 },
      high:     { solo: 690, practice: 1190, group: 1690 },
    },
  },
  dm: {
    label: "Social media DMs",
    desc: "Replies to Instagram and Facebook enquiries and books them.",
    monthly: {
      standard: { solo: 290, practice: 490, group: 690 },
      high:     { solo: 490, practice: 890, group: 1290 },
    },
  },
  outbound: {
    label: "Form to outbound",
    desc: "Calls or texts every form lead within 60 seconds and books them.",
    monthly: {
      standard: { solo: 190, practice: 290, group: 390 },
      high:     { solo: 290, practice: 490, group: 690 },
    },
  },
};

/** Share off the monthly for taking 2 or 3 core channels. */
export const CHANNEL_DISCOUNT: Record<2 | 3, number> = { 2: 0.1, 3: 0.15 };

/** Each core product after the first (or after one already live) is this share of setup. */
export const EXTRA_PRODUCT_SETUP_FACTOR = 0.5;

/** Off setup and monthly when the practice software has no API (team confirms bookings). */
export const NO_API_DISCOUNT = 0.2;

/** Extra locations: share of the setup and of the monthly. */
export const LOCATION_SETUP_FACTOR = 0.5;
export const LOCATION_MONTHLY_FACTOR = 0.75;

/** Booking fee ($) per offer, by whether Ivory can book into the practice software. */
export const FEES: Record<"yes" | "no", Record<OfferKind, number>> = {
  yes: { low: 35, mid: 60, high: 120 },
  no:  { low: 20, mid: 30, high: 60 },
};

export const OFFER_KIND: Record<OfferKind, string> = {
  low:  "Offer under $200",
  mid:  "Offer $200 to $500",
  high: "High-value treatment consult",
};

export const DISCOUNT_REASON_LABEL: Record<Exclude<DiscountReason, "none">, string> = {
  term:      "12-month term",
  upfront:   "Upfront payment",
  casestudy: "Case study rights",
};

export const MAX_SETUP_DISCOUNT_PCT = 50;
export const GST_MULTIPLIER = 1.1;

/** Campaigns billed per run rather than monthly. */
export const CAMPAIGN = {
  reactivation: { perContact: 1.5, minimum: 750 },
  recall:       { perContact: 1.5, minimum: 300 },
} as const;

export type Upsell = {
  id: UpsellId;
  /** rev = revenue upsell, eff = efficiency upsell */
  group: "rev" | "eff";
  name: string;
  desc: string;
  setup?: number;
  /** Either one [solo, practice, group] triple, or a triple per band. */
  monthly?: Triple | Record<Band, Triple>;
  types: ClinicType[] | "all";
  /** "yes" = needs practice-software access; "both" = works either way. */
  pms: "yes" | "both";
};

export const UPSELLS: Upsell[] = [
  { id: "treatment",    group: "rev", name: "Treatment follow-up",
    desc: "Chases patients with treatment plans they never booked.",
    setup: 1000, monthly: { standard: [190, 290, 390], high: [390, 590, 790] }, types: "all", pms: "yes" },
  { id: "nurture",      group: "rev", name: "Post-consult nurture",
    desc: "Follows up patients who had a consult but didn't go ahead.",
    setup: 1000, monthly: [290, 490, 690], types: ["cosdental", "ortho", "cosskin"], pms: "yes" },
  { id: "backfill",     group: "rev", name: "Cancellation backfill",
    desc: "Fills cancelled slots from a waitlist within minutes.",
    setup: 500, monthly: [149, 249, 349], types: "all", pms: "yes" },
  { id: "recall",       group: "rev", name: "Recall automation",
    desc: "Books routine check-ups and repeat treatments. SMS first, then a call.",
    setup: 500, monthly: [149, 249, 349], types: ["chiro", "gendental", "cosdental", "ortho", "cosskin"], pms: "both" },
  { id: "coaching",     group: "rev", name: "Front-desk call coaching",
    desc: "Scores the clinic's own reception calls and gives coaching.",
    setup: 1000, monthly: [190, 290, 390], types: "all", pms: "both" },
  { id: "reactivation", group: "rev", name: "Patient reactivation",
    desc: "Brings back lapsed patients. SMS first, then a call.",
    types: "all", pms: "both" },
  { id: "existing",     group: "eff", name: "Existing patient handling",
    desc: "Reschedules, cancellations and questions from current patients.",
    setup: 1000, monthly: [290, 490, 690], types: "all", pms: "yes" },
  { id: "guru",         group: "eff", name: "Guru-style AI trainer",
    desc: "Answers new front-desk staff questions about the clinic's rules.",
    setup: 1000, monthly: [149, 249, 349], types: "all", pms: "both" },
  { id: "intake",       group: "eff", name: "AI intake and questionnaires",
    desc: "Collects what the clinic needs before the first visit.",
    setup: 500, monthly: [149, 249, 349], types: "all", pms: "yes" },
  { id: "review",       group: "eff", name: "Review responder",
    desc: "Drafts Google review replies that never confirm someone is a patient.",
    setup: 500, monthly: [99, 149, 199], types: "all", pms: "both" },
];

/* ── Quote state ─────────────────────────────────────────────────────────── */

export type Offer = { id: string; name: string; kind: OfferKind };
export type ExtraLocation = { id: string; name: string; practitioners: string };

/**
 * Everything the user can edit. Numeric fields are strings so a field can be
 * blank without becoming 0; the engine parses them.
 */
export type QuoteState = {
  clinic: string;
  type: ClinicType;
  practitioners: string;
  tierOverride: "auto" | Tier;
  pms: "yes" | "no";
  pmsName: string;
  leads: string;
  notes: string;
  core: Record<CoreKey, { state: CoreStatus; legacy: string }>;
  offers: Offer[];
  cap: string;
  locations: ExtraLocation[];
  upsells: Partial<Record<UpsellId, boolean>>;
  reactivationContacts: string;
  recallContacts: string;
  term: "m2m" | "12";
  discountReason: DiscountReason;
  discountPct: string;
  spread: boolean;
  gst: boolean;
  apptOverride: string;
  valueOverride: string;
};

let idCounter = 0;
/** Unique id for list rows. Only call from event handlers, never during render. */
export function newId(): string {
  idCounter += 1;
  return `r${Date.now().toString(36)}${idCounter}`;
}

/** A blank quote. Deterministic (no random ids) so server and client render the same. */
export function defaultState(): QuoteState {
  return {
    clinic: "",
    type: "physio",
    practitioners: "2",
    tierOverride: "auto",
    pms: "yes",
    pmsName: "",
    leads: "",
    notes: "",
    core: {
      inbound:  { state: "new", legacy: "" },
      dm:       { state: "off", legacy: "" },
      outbound: { state: "off", legacy: "" },
    },
    offers: [{ id: "offer-1", name: "", kind: "low" }],
    cap: "",
    locations: [],
    upsells: {},
    reactivationContacts: "600",
    recallContacts: "300",
    term: "m2m",
    discountReason: "none",
    discountPct: "0",
    spread: false,
    gst: false,
    apptOverride: "",
    valueOverride: "",
  };
}

/* ── Restoring saved state ───────────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Strings and numbers come back as strings; anything else becomes the fallback. */
function str(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Rebuild a QuoteState from anything read back out of storage. Unknown or
 * malformed fields fall back to the defaults, so an old or hand-edited save
 * can never crash the page.
 */
export function restoreState(saved: unknown): QuoteState {
  const d = defaultState();
  if (!isObj(saved)) return d;

  const core = isObj(saved.core) ? saved.core : {};
  const restoredCore = {} as QuoteState["core"];
  for (const p of CORE_ORDER) {
    const c = isObj(core[p]) ? (core[p] as Record<string, unknown>) : {};
    restoredCore[p] = {
      state: oneOf(c.state, ["off", "new", "live"] as const, d.core[p].state),
      legacy: str(c.legacy, ""),
    };
  }

  const offers: Offer[] = Array.isArray(saved.offers)
    ? saved.offers.filter(isObj).map((o, i) => ({
        id: str(o.id, `offer-${i + 1}`),
        name: str(o.name, ""),
        kind: oneOf(o.kind, ["low", "mid", "high"] as const, "low"),
      }))
    : d.offers;

  const locations: ExtraLocation[] = Array.isArray(saved.locations)
    ? saved.locations.filter(isObj).map((l, i) => ({
        id: str(l.id, `loc-${i + 1}`),
        name: str(l.name, ""),
        practitioners: str(l.practitioners, "2"),
      }))
    : [];

  const upsells: QuoteState["upsells"] = {};
  if (isObj(saved.upsells)) {
    for (const u of UPSELLS) if (saved.upsells[u.id] === true) upsells[u.id] = true;
  }

  return {
    clinic: str(saved.clinic, ""),
    type: oneOf(saved.type, CLINIC_TYPES.map((t) => t.id), d.type),
    practitioners: str(saved.practitioners, d.practitioners),
    tierOverride: oneOf(saved.tierOverride, ["auto", "solo", "practice", "group"] as const, "auto"),
    pms: oneOf(saved.pms, ["yes", "no"] as const, "yes"),
    pmsName: str(saved.pmsName, ""),
    leads: str(saved.leads, ""),
    notes: str(saved.notes, ""),
    core: restoredCore,
    offers,
    cap: str(saved.cap, ""),
    locations,
    upsells,
    reactivationContacts: str(saved.reactivationContacts, d.reactivationContacts),
    recallContacts: str(saved.recallContacts, d.recallContacts),
    term: oneOf(saved.term, ["m2m", "12"] as const, "m2m"),
    discountReason: oneOf(saved.discountReason, ["none", "term", "upfront", "casestudy"] as const, "none"),
    discountPct: str(saved.discountPct, "0"),
    spread: saved.spread === true,
    gst: saved.gst === true,
    apptOverride: str(saved.apptOverride, ""),
    valueOverride: str(saved.valueOverride, ""),
  };
}

/** localStorage keys. v2 = the Oct 2026 pricing model; v1/assumptions.v4 belonged to the old builder. */
export const DRAFT_KEY = "agentIvory.quote.draft.v2";
export const SAVED_KEY = "agentIvory.quote.saved.v2";
