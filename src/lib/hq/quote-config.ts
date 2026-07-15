/**
 * Quote Builder — pricing configuration.
 *
 * Ported 1:1 from the standalone HTML calculator. Assumption values are
 * DEFAULTS; the user's tuned copy persists in localStorage under LS_KEY
 * (same key as the standalone tool, so saved assumptions carry over).
 */

export type ModuleKey =
  | "inbound" | "outbound" | "chatbot" | "textback"
  | "reminders" | "leadfu" | "reviews" | "intake";

export type FlatModule = { setup: number; monthly: number; voice: boolean; name: string };

export type Assumptions = {
  inbound: {
    name: string; voice: boolean;
    setupBase: number; monthlyBase: number;
    perCalendarSetup: number; perCalendarMonthly: number;
    perLocationSetup: number; perLocationMonthly: number;
  };
  bands: { label: string; max: number; add: number }[];
  outbound: { setup: number; perContact: number; voice: boolean; name: string };
  chatbot: FlatModule; textback: FlatModule; reminders: FlatModule;
  leadfu: FlatModule; reviews: FlatModule; intake: FlatModule;
  discFd: number; discFdp: number; discGe: number;
  cogsPerMin: number; smsCost: number; platformCost: number;
  leadConv: number; humanMonthly: number;
  obConvLow: number; obConvExp: number; obConvHigh: number; obVisits: number;
};

export const DEFAULTS: Assumptions = {
  inbound: { name: "Inbound AI receptionist", voice: true,
    setupBase: 590, monthlyBase: 290,
    perCalendarSetup: 170, perCalendarMonthly: 55,
    perLocationSetup: 390, perLocationMonthly: 90 },
  bands: [
    { label: "Light",    max: 500,  add: 0 },
    { label: "Standard", max: 1200, add: 70 },
    { label: "Busy",     max: 2500, add: 160 },
    { label: "High",     max: 4000, add: 290 },
  ],
  outbound:  { setup: 1200, perContact: 1.25, voice: true, name: "Outbound AI agent" },
  chatbot:   { setup: 650, monthly: 197, voice: false, name: "AI chatbot (web/social)" },
  textback:  { setup: 290, monthly: 89,  voice: false, name: "Missed-call text-back" },
  reminders: { setup: 390, monthly: 149, voice: false, name: "Reminders + reactivation" },
  leadfu:    { setup: 490, monthly: 197, voice: false, name: "Lead follow-up automation" },
  reviews:   { setup: 390, monthly: 129, voice: false, name: "Review response automation" },
  intake:    { setup: 390, monthly: 149, voice: false, name: "AI intake + questionnaires" },
  discFd: 15, discFdp: 20, discGe: 25,
  cogsPerMin: 0.17, smsCost: 0.05, platformCost: 35,
  leadConv: 30, humanMonthly: 6200,
  obConvLow: 8, obConvExp: 12, obConvHigh: 20, obVisits: 4,
};

export type BizType = "dental" | "cosmetic" | "medspa" | "physio" | "salon" | "dealer" | "other";
export type VolumeUnit = "day" | "week" | "month";

export type Preset = {
  calendars: number; calls: number; vu: VolumeUnit; dur: number;
  leads: number; clients: number; jobValue: number; missRate: number; contacts: number;
};

export const PRESETS: Record<BizType, Preset> = {
  dental:   { calendars: 4, calls: 120, vu: "week", dur: 3,   leads: 140, clients: 2200, jobValue: 340,  missRate: 30, contacts: 900 },
  cosmetic: { calendars: 3, calls: 90,  vu: "week", dur: 3.5, leads: 160, clients: 1400, jobValue: 650,  missRate: 32, contacts: 600 },
  medspa:   { calendars: 3, calls: 80,  vu: "week", dur: 3.5, leads: 150, clients: 1200, jobValue: 420,  missRate: 30, contacts: 500 },
  physio:   { calendars: 3, calls: 100, vu: "week", dur: 2.5, leads: 120, clients: 1800, jobValue: 95,   missRate: 26, contacts: 700 },
  salon:    { calendars: 4, calls: 140, vu: "week", dur: 2,   leads: 130, clients: 2600, jobValue: 120,  missRate: 34, contacts: 1100 },
  dealer:   { calendars: 6, calls: 210, vu: "week", dur: 4,   leads: 260, clients: 3500, jobValue: 1200, missRate: 38, contacts: 1500 },
  other:    { calendars: 2, calls: 100, vu: "week", dur: 3,   leads: 120, clients: 1800, jobValue: 280,  missRate: 28, contacts: 600 },
};

export const BIZ_LABELS: Record<BizType, string> = {
  dental: "Dental practice", cosmetic: "Cosmetic clinic", medspa: "Medspa",
  physio: "Physio / Chiro", salon: "Salon / Beauty", dealer: "Car dealership",
  other: "Other appointment-based",
};

export const FLAT_MODS = ["chatbot", "textback", "reminders", "leadfu", "reviews", "intake"] as const;
export const MOD_ORDER: ModuleKey[] = ["inbound", "outbound", "chatbot", "textback", "reminders", "leadfu", "reviews", "intake"];

export type PackageKey = "custom" | "fd" | "fdp" | "ge";
export const BUNDLES: Record<Exclude<PackageKey, "custom">, { name: string; disc: "discFd" | "discFdp" | "discGe"; mods: ModuleKey[] }> = {
  fd:  { name: "Front Desk",     disc: "discFd",  mods: ["inbound", "textback", "reminders"] },
  fdp: { name: "Front Desk Pro", disc: "discFdp", mods: ["inbound", "textback", "reminders", "chatbot", "leadfu", "intake"] },
  ge:  { name: "Growth Engine",  disc: "discGe",  mods: ["inbound", "textback", "reminders", "chatbot", "leadfu", "intake", "outbound", "reviews"] },
};

export const VU_FACTOR: Record<VolumeUnit, number> = { day: 21.7, week: 4.33, month: 1 };

// Same key as the standalone HTML tool — saved assumptions carry over.
export const LS_KEY = "agentIvoryQuote.assumptions.v4";
