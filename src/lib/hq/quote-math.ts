/**
 * Quote Builder — pricing engine.
 *
 * Pure function port of the standalone calculator's calc(). Same inputs,
 * same outputs, no DOM — so it can be unit-checked against the original
 * and reused anywhere (e.g. a future "save quote to CRM" feature).
 */

import {
  Assumptions, BUNDLES, FLAT_MODS, ModuleKey, PackageKey, VolumeUnit, VU_FACTOR,
} from "./quote-config";

export type QuoteInputs = {
  calendars: number;
  locations: number;
  calls:     number;      // raw, in the unit given
  vu:        VolumeUnit;
  dur:       number;      // avg call minutes
  leads:     number;      // discovery-only; not used in pricing maths
  clients:   number;      // active client base — drives reminders COGS
  jobValue:  number;
  missRate:  number;      // percent 0-100
  contacts:  number;      // reactivation list size
};

export type BreakdownItem = {
  label:         string;
  sub?:          string;
  setup:         number;
  monthly:       number;
  anchor?:       boolean;
  campaign?:     boolean;   // billed per run, not monthly
  campaignCost?: number;
  custom?:       boolean;   // above top volume band — price is a floor
};

export type QuoteResult = {
  monthlyCalls: number;
  estMin:       number;
  profileName:  string;
  items:        BreakdownItem[];
  aboveTopBand: boolean;
  setupRaw:     number;
  monthlyRaw:   number;
  discount:     number;     // 0..1
  pkgName:      string;
  setupFinal:   number;
  monthlyFinal: number;
  yearOne:      number;
  annualSaving: number;     // saved per year when annual prepay is on
  missCalls:    number;
  leakMonth:    number;
  leakYear:     number;
  campaignCost: number;
  outboundRoi:  null | {
    bookExp: number; recExp: number; recLow: number; recHigh: number; takePct: number;
  };
  cogs:         number;
  campaignCogs: number;
  grossProfit:  number;
  marginPct:    number;
  voiceMin:     number;
};

export function profileFor(cal: number, loc: number): string {
  if (loc > 1 || cal >= 7) return "Multi-site group";
  if (cal >= 4) return "Group practice";
  if (cal >= 2) return "Small clinic";
  return "Sole trader";
}

function volumeBand(A: Assumptions, estMin: number) {
  for (const b of A.bands) {
    if (estMin <= b.max) return { label: b.label, add: b.add, custom: false };
  }
  const top = A.bands[A.bands.length - 1];
  return { label: top.label, add: top.add, custom: true };
}

export function computeQuote(opts: {
  inputs:   QuoteInputs;
  A:        Assumptions;
  selected: Set<ModuleKey>;
  pkg:      PackageKey;
  annual:   boolean;
}): QuoteResult {
  const { inputs, A, selected, pkg, annual } = opts;

  const calendars = Math.max(1, Math.floor(inputs.calendars) || 1);
  const locations = Math.max(1, Math.floor(inputs.locations) || 1);
  const monthlyCalls = (inputs.calls || 0) * VU_FACTOR[inputs.vu];
  const estMin = monthlyCalls * (inputs.dur || 0);
  const missRate = (inputs.missRate || 0) / 100;

  // ── Assemble line items ───────────────────────────────────────────────────
  const items: BreakdownItem[] = [];
  let aboveTopBand = false;

  if (selected.has("inbound")) {
    const inb = A.inbound;
    items.push({
      label: "Inbound receptionist — core build",
      sub: "discovery, call flows, 1st calendar & integration",
      setup: inb.setupBase, monthly: inb.monthlyBase, anchor: true,
    });
    if (calendars > 1) items.push({
      label: `+ ${calendars - 1} extra practitioner calendar${calendars - 1 > 1 ? "s" : ""}`,
      setup: inb.perCalendarSetup * (calendars - 1),
      monthly: inb.perCalendarMonthly * (calendars - 1),
    });
    if (locations > 1) items.push({
      label: `+ ${locations - 1} extra location${locations - 1 > 1 ? "s" : ""}`,
      setup: inb.perLocationSetup * (locations - 1),
      monthly: inb.perLocationMonthly * (locations - 1),
    });
    const band = volumeBand(A, estMin);
    items.push({
      label: `${band.label} call capacity`,
      sub: `~${Math.round(estMin).toLocaleString("en-AU")} talk-min / month`,
      setup: 0, monthly: band.add, custom: band.custom,
    });
    aboveTopBand = band.custom;
  }

  let campaignCost = 0;
  if (selected.has("outbound")) {
    items.push({
      label: "Outbound agent — build & script",
      sub: "voice setup, list prep, campaign flow",
      setup: A.outbound.setup, monthly: 0,
    });
    campaignCost = A.outbound.perContact * (inputs.contacts || 0);
    items.push({
      label: "Reactivation campaign",
      sub: `${Math.round(inputs.contacts || 0).toLocaleString("en-AU")} contacts · billed per run`,
      setup: 0, monthly: 0, campaign: true, campaignCost,
    });
  }

  for (const k of FLAT_MODS) {
    if (selected.has(k)) items.push({ label: A[k].name, setup: A[k].setup, monthly: A[k].monthly });
  }

  // ── Totals + bundle discount ──────────────────────────────────────────────
  const setupRaw   = items.reduce((s, it) => s + it.setup, 0);
  const monthlyRaw = items.reduce((s, it) => s + it.monthly, 0);

  let discount = 0, pkgName = "Custom build";
  if (pkg !== "custom") {
    discount = A[BUNDLES[pkg].disc] / 100;
    pkgName  = BUNDLES[pkg].name;
  }
  const setupFinal   = setupRaw * (1 - discount);
  const monthlyFinal = monthlyRaw * (1 - discount);

  const yearOne = annual ? setupFinal + monthlyFinal * 10 : setupFinal + monthlyFinal * 12;
  const annualSaving = monthlyFinal * 2;

  // ── The pain: revenue leakage ─────────────────────────────────────────────
  const missCalls = monthlyCalls * missRate;
  const leakMonth = missCalls * (A.leadConv / 100) * (inputs.jobValue || 0);
  const leakYear  = leakMonth * 12;

  // ── Internal: COGS + margin ───────────────────────────────────────────────
  const voiceMin = selected.has("inbound") ? estMin : 0;
  let cogs = voiceMin * A.cogsPerMin + A.platformCost;
  if (selected.has("reminders")) cogs += (inputs.clients || 0) * 0.4 * A.smsCost;
  if (selected.has("textback"))  cogs += missCalls * A.smsCost;
  const campaignCogs = selected.has("outbound") ? (inputs.contacts || 0) * 1.4 * A.cogsPerMin : 0;
  const grossProfit = monthlyFinal - cogs;
  const marginPct = monthlyFinal > 0 ? (grossProfit / monthlyFinal) * 100 : 0;

  // ── Outbound campaign ROI ─────────────────────────────────────────────────
  let outboundRoi: QuoteResult["outboundRoi"] = null;
  if (selected.has("outbound") && (inputs.contacts || 0) > 0) {
    const episode = A.obVisits * (inputs.jobValue || 0);
    const recExp  = inputs.contacts * (A.obConvExp / 100) * episode;
    outboundRoi = {
      bookExp: inputs.contacts * (A.obConvExp / 100),
      recExp,
      recLow:  inputs.contacts * (A.obConvLow / 100) * episode,
      recHigh: inputs.contacts * (A.obConvHigh / 100) * episode,
      takePct: recExp > 0 ? (campaignCost / recExp) * 100 : 0,
    };
  }

  return {
    monthlyCalls, estMin,
    profileName: profileFor(calendars, locations),
    items, aboveTopBand,
    setupRaw, monthlyRaw, discount, pkgName, setupFinal, monthlyFinal,
    yearOne, annualSaving,
    missCalls, leakMonth, leakYear,
    campaignCost, outboundRoi,
    cogs, campaignCogs, grossProfit, marginPct, voiceMin,
  };
}

/** Which bundle exactly matches a module selection (for tab highlighting). */
export function matchBundle(selected: Set<ModuleKey>): PackageKey {
  for (const [key, b] of Object.entries(BUNDLES)) {
    if (b.mods.length === selected.size && b.mods.every((m) => selected.has(m))) {
      return key as PackageKey;
    }
  }
  return "custom";
}
