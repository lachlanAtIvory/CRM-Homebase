/**
 * Quote Builder — pricing engine.
 *
 * Pure functions only: QuoteState in, priced quote out. No React, no storage,
 * no rounding until display, so the maths can be tested on its own. All
 * prices and rules come from quote-config.ts.
 */

import {
  BASE_APPTS, Band, CAMPAIGN, CHANNEL_DISCOUNT, CLINIC_TYPES, CORE, CORE_ORDER,
  DEFAULT_APPT_VALUE, DISCOUNT_REASON_LABEL, EXTRA_CHANNEL_APPT_LIFT,
  EXTRA_PRODUCT_SETUP_FACTOR, FEES, FLOOR_SETUP, GST_MULTIPLIER, HOURLY_FLOOR,
  LOCATION_MONTHLY_FACTOR, LOCATION_SETUP_FACTOR, MAX_SETUP_DISCOUNT_PCT,
  NO_API_DISCOUNT, OFFER_KIND, QuoteState, SETUP, Tier, TIER_INDEX, TIER_LABEL,
  TIER_MAX_PRACTITIONERS, Upsell, UPSELLS,
} from "./quote-config";

export type Line = { label: string; amt: number; neg?: boolean };

export type QuoteResult = {
  tier: Tier;
  band: Band;
  integrates: boolean;
  /** Number of core channels included (0-3). */
  count: number;
  setup: Line[];
  monthly: Line[];
  /** Campaigns billed per run, not monthly. */
  runs: Line[];
  /** Booking / handoff fees, one per ad offer. */
  fees: Line[];
  flags: string[];
  setupTotal: number;
  monthlyTotal: number;
  /** Default recovered appointments a month, before any override. */
  defAppts: number;
  defValue: number;
  appts: number;
  /** Value per appointment actually used. */
  per: number;
  /** Monthly value recovered = appts x per. */
  value: number;
  /** Monthly value divided by the monthly fee. */
  ret: number;
  /** Days for the monthly gain to repay setup, or null if it never does. */
  payback: number | null;
};

/* ── Small helpers ───────────────────────────────────────────────────────── */

/** Parse a form field; blank or junk is 0. */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function tierOf(practitioners: unknown): Tier {
  const n = num(practitioners) || 1;
  return n <= TIER_MAX_PRACTITIONERS.solo ? "solo" : n <= TIER_MAX_PRACTITIONERS.practice ? "practice" : "group";
}

export function mainTier(s: QuoteState): Tier {
  return s.tierOverride !== "auto" ? s.tierOverride : tierOf(s.practitioners);
}

export function bandOf(s: QuoteState): Band {
  return CLINIC_TYPES.find((t) => t.id === s.type)?.band ?? "standard";
}

export function integrates(s: QuoteState): boolean {
  return s.pms === "yes";
}

/** Whether an upsell suits this clinic type and practice-software setup. */
export function upsellAvailable(u: Upsell, s: QuoteState): boolean {
  if (u.types !== "all" && !u.types.includes(s.type)) return false;
  if (!integrates(s) && u.pms === "yes") return false;
  return true;
}

export function upsellMonthly(u: Upsell, tier: Tier, band: Band): number {
  if (!u.monthly) return 0;
  const triple = Array.isArray(u.monthly) ? u.monthly : u.monthly[band];
  return triple[TIER_INDEX[tier]];
}

const money0 = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,234" (or "-$1,234"); pass dp 2 for cents. */
export function money(n: number, dp: 0 | 2 = 0): string {
  const rounded = Math.round(n * (dp ? 100 : 1)) / (dp ? 100 : 1);
  return (rounded < 0 ? "-$" : "$") + (dp ? money2 : money0).format(Math.abs(rounded));
}

export function gstFactor(s: QuoteState): number {
  return s.gst ? GST_MULTIPLIER : 1;
}

export function gstLabel(s: QuoteState): string {
  return s.gst ? "inc GST" : "ex GST";
}

/* ── The quote ───────────────────────────────────────────────────────────── */

export function computeQuote(s: QuoteState): QuoteResult {
  const band = bandOf(s);
  const tier = mainTier(s);
  const ok = integrates(s);

  const included = CORE_ORDER.filter((p) => s.core[p].state !== "off");
  const count = included.length;
  const channelPct = count >= 3 ? CHANNEL_DISCOUNT[3] : count === 2 ? CHANNEL_DISCOUNT[2] : 0;
  const anyLive = included.some((p) => s.core[p].state === "live");

  const setup: Line[] = [];
  const monthly: Line[] = [];
  const runs: Line[] = [];
  const fees: Line[] = [];
  const flags: string[] = [];

  // Setup: the first product we build is full price, the rest half. A product
  // that is already live counts as the first, so everything new is half.
  let charged = anyLive;
  let coreSetup = 0;
  for (const p of included) {
    if (s.core[p].state !== "new") continue;
    const half = charged;
    const amt = half ? SETUP[tier] * EXTRA_PRODUCT_SETUP_FACTOR : SETUP[tier];
    charged = true;
    coreSetup += amt;
    setup.push({ label: CORE[p].label + (half ? " (half price)" : ""), amt });
  }
  if (!ok && coreSetup > 0) {
    setup.push({ label: "Can't integrate (20% off)", amt: -coreSetup * NO_API_DISCOUNT, neg: true });
  }

  // Monthly: live products on old pricing keep their current price and sit
  // outside the no-API and channel discounts.
  let list = 0;
  for (const p of included) {
    const c = s.core[p];
    if (c.state === "live" && c.legacy.trim() !== "") {
      monthly.push({ label: CORE[p].label + " (current price)", amt: num(c.legacy) });
    } else {
      const amt = CORE[p].monthly[band][tier];
      list += amt;
      monthly.push({ label: CORE[p].label + (c.state === "live" ? " (live)" : ""), amt });
    }
  }
  if (!ok && list > 0) {
    monthly.push({ label: "Can't integrate (20% off)", amt: -list * NO_API_DISCOUNT, neg: true });
  }
  const afterNoApi = ok ? list : list * (1 - NO_API_DISCOUNT);
  if (channelPct > 0 && afterNoApi > 0) {
    monthly.push({
      label: `${count}-channel discount (${Math.round(channelPct * 100)}%)`,
      amt: -afterNoApi * channelPct,
      neg: true,
    });
  }

  // Extra locations: priced by their own tier, same products as the main site.
  for (const loc of s.locations) {
    if (!count) continue;
    const lt = tierOf(loc.practitioners);
    let locCharged = anyLive;
    let locSetup = 0;
    let locMonthly = 0;
    for (const p of included) {
      if (s.core[p].state === "new") {
        locSetup += locCharged ? SETUP[lt] * EXTRA_PRODUCT_SETUP_FACTOR : SETUP[lt];
        locCharged = true;
      }
      locMonthly += CORE[p].monthly[band][lt];
    }
    const apiFactor = ok ? 1 : 1 - NO_API_DISCOUNT;
    locSetup = locSetup * apiFactor * LOCATION_SETUP_FACTOR;
    locMonthly = locMonthly * apiFactor * (1 - channelPct) * LOCATION_MONTHLY_FACTOR;
    const name = loc.name.trim() || "Extra location";
    if (locSetup > 0) setup.push({ label: `${name} (${TIER_LABEL[lt]}, half price)`, amt: locSetup });
    if (locMonthly > 0) monthly.push({ label: `${name} (${TIER_LABEL[lt]}, 75%)`, amt: locMonthly });
  }

  // Upsells.
  for (const u of UPSELLS) {
    if (!s.upsells[u.id] || !upsellAvailable(u, s)) continue;
    if (u.id === "reactivation") {
      const c = num(s.reactivationContacts);
      runs.push({
        label: `Patient reactivation, ${c.toLocaleString("en-AU")} contacts`,
        amt: Math.max(c * CAMPAIGN.reactivation.perContact, CAMPAIGN.reactivation.minimum),
      });
      continue;
    }
    if (u.id === "recall" && !ok) {
      const c = num(s.recallContacts);
      runs.push({
        label: `Recall campaign from CSV, ${c.toLocaleString("en-AU")} contacts`,
        amt: Math.max(c * CAMPAIGN.recall.perContact, CAMPAIGN.recall.minimum),
      });
      continue;
    }
    setup.push({ label: u.name, amt: u.setup ?? 0 });
    monthly.push({ label: u.name, amt: upsellMonthly(u, tier, band) });
  }

  // Setup discount: only in exchange for something, and never below the floor.
  const setupSubtotal = setup.reduce((sum, l) => sum + l.amt, 0);
  const pct = Math.min(Math.max(num(s.discountPct), 0), MAX_SETUP_DISCOUNT_PCT);
  if (pct > 0 && s.discountReason === "none") {
    flags.push("Pick what the clinic gives in exchange before a setup discount applies.");
  } else if (pct > 0 && setupSubtotal > 0 && s.discountReason !== "none") {
    setup.push({
      label: `${DISCOUNT_REASON_LABEL[s.discountReason]} (${pct}% off setup)`,
      amt: -setupSubtotal * pct / 100,
      neg: true,
    });
    const keep = FLOOR_SETUP[tier] / SETUP[tier];
    if (1 - pct / 100 < keep - 1e-9) {
      flags.push(
        `A ${pct}% setup discount takes a ${TIER_LABEL[tier]} build below your $${HOURLY_FLOOR} an hour floor. ` +
        `Keep it to ${Math.floor((1 - keep) * 100)}% or less.`,
      );
    }
  }

  // Booking / handoff fees, one per ad offer. Only apply with form-to-outbound.
  if (s.core.outbound.state !== "off") {
    const table = FEES[s.pms];
    for (const o of s.offers) {
      fees.push({ label: o.name.trim() || OFFER_KIND[o.kind], amt: table[o.kind] });
    }
    if (!s.offers.length) flags.push("Add the ad offer so the booking fee is set.");
  }

  const setupTotal = setup.reduce((sum, l) => sum + l.amt, 0);
  const monthlyTotal = monthly.reduce((sum, l) => sum + l.amt, 0);

  // Return: recovered appointments scale with size and extra channels.
  const tiers: Tier[] = [tier, ...s.locations.map((l) => tierOf(l.practitioners))];
  const defAppts = count
    ? Math.round(tiers.reduce((sum, t) => sum + BASE_APPTS[t] * (1 + EXTRA_CHANNEL_APPT_LIFT * (count - 1)), 0))
    : 0;
  const defValue = DEFAULT_APPT_VALUE[band];
  const appts = s.apptOverride.trim() !== "" ? num(s.apptOverride) : defAppts;
  const per = s.valueOverride.trim() !== "" ? num(s.valueOverride) : defValue;
  const value = appts * per;
  const ret = monthlyTotal > 0 ? value / monthlyTotal : 0;
  const payback = value > monthlyTotal && setupTotal > 0
    ? Math.ceil(setupTotal / ((value - monthlyTotal) / 30.4))
    : null;

  if (!count) flags.push("Pick at least one core product.");
  if (count && ret > 0 && ret < 5) {
    flags.push("Return is under 5x. Check their real numbers, or recommend fewer channels and start with where most of their leads come from.");
  }
  if (s.upsells.coaching && upsellAvailable(UPSELLS.find((u) => u.id === "coaching")!, s) && tier === "solo") {
    flags.push("Call coaching rarely pays off for a Solo clinic with one receptionist.");
  }

  return {
    tier, band, integrates: ok, count,
    setup, monthly, runs, fees, flags,
    setupTotal, monthlyTotal,
    defAppts, defValue, appts, per, value, ret, payback,
  };
}

/* ── Plain-text quote (the Copy button) ──────────────────────────────────── */

export function quoteText(s: QuoteState, r: QuoteResult): string {
  const g = gstFactor(s);
  const label = gstLabel(s);
  const L: string[] = [];
  const name = s.clinic.trim();

  L.push("Agent Ivory quote" + (name ? " for " + name : ""));
  L.push("");
  L.push(
    `Setup (one-off): ${money(r.setupTotal * g)} ${label}` +
    (s.spread && r.setupTotal > 0 ? `, or 3 payments of ${money(r.setupTotal * g / 3)}` : ""),
  );
  for (const l of r.setup) L.push(`  - ${l.label}: ${money(l.amt * g)}`);
  L.push("");
  L.push(`Monthly: ${money(r.monthlyTotal * g)} ${label}` + (s.term === "12" ? ", 12-month term" : ", month to month"));
  for (const l of r.monthly) L.push(`  - ${l.label}: ${money(l.amt * g)}`);

  if (r.fees.length) {
    L.push("");
    L.push(r.integrates ? "Booking fees (per attended booking):" : "Handoff fees (per qualified lead passed to your team):");
    for (const l of r.fees) L.push(`  - ${l.label}: ${money(l.amt * g)}`);
    if (num(s.cap) > 0) L.push(`  - Monthly cap on these fees: ${money(num(s.cap) * g)}`);
  }
  if (r.runs.length) {
    L.push("");
    L.push("Campaigns (billed per run):");
    for (const l of r.runs) L.push(`  - ${l.label}: ${money(l.amt * g)}`);
  }
  if (r.count && r.monthlyTotal > 0) {
    L.push("");
    L.push(
      `Expected return: about ${money(r.value)} a month recovered, roughly ${r.ret.toFixed(1)}x the monthly fee.` +
      (r.payback ? ` Setup pays for itself in about ${r.payback} days.` : ""),
    );
  }
  L.push("");
  L.push("Included: unlimited usage (fair use applies) and a monthly results report.");
  return L.join("\n");
}
