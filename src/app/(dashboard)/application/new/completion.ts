import type { TeamMember } from "./actions";

/**
 * Each form area contributes a weight. Required areas (must be filled to
 * finalise) get the biggest weights. Total weight is calibrated so that
 * filling only the required fields lands you at ~52% — enough to feel
 * progress, but clearly incomplete. Filling everything sensible → 100%.
 */
type Check = {
  key:        string;
  label:      string;
  weight:     number;
  required:   boolean;
  ok:         boolean;
};

export type FormShape = {
  company_name:        string;
  owner_name:          string;
  contact_email:       string;
  contact_phone:       string;
  abn:                 string;
  trading_address:     string;
  uses_single_calendar: boolean | null;
  team_members:        TeamMember[];
  selected_products:   string[];
  goals:               string;
  requirements:        string;
};

export type CompletionResult = {
  percent:         number;
  canFinalise:     boolean;
  missingRequired: string[];   // human-readable labels
};

export function computeCompletion(v: FormShape): CompletionResult {
  const checks: Check[] = [
    // ─── Required ──────────────────────────────────────────────────────────
    { key: "company_name",   label: "Company name",          weight: 10, required: true,  ok: !!v.company_name.trim() },
    { key: "contact_email",  label: "Contact email",         weight: 10, required: true,  ok: /\S+@\S+\.\S+/.test(v.contact_email.trim()) },
    { key: "products",       label: "At least one product",  weight: 10, required: true,  ok: v.selected_products.length > 0 },
    { key: "calendar",       label: "Single-calendar choice",weight:  8, required: true,  ok: v.uses_single_calendar !== null },

    // ─── Optional but contribute to completion ─────────────────────────────
    { key: "owner_name",     label: "Owner name",            weight:  5, required: false, ok: !!v.owner_name.trim() },
    { key: "contact_phone",  label: "Phone",                 weight:  5, required: false, ok: !!v.contact_phone.trim() },
    { key: "abn",            label: "ABN",                   weight:  5, required: false, ok: !!v.abn.trim() },
    { key: "trading_address",label: "Trading address",       weight:  5, required: false, ok: !!v.trading_address.trim() },
    { key: "team_members",   label: "At least one team member", weight: 8, required: false, ok: v.team_members.some((m) => m.name.trim().length > 0) },
    { key: "goals",          label: "Goals",                 weight:  7, required: false, ok: !!v.goals.trim() },
    { key: "requirements",   label: "Requirements",          weight:  7, required: false, ok: !!v.requirements.trim() },
  ];

  const total  = checks.reduce((s, c) => s + c.weight, 0);
  const filled = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
  const missingRequired = checks.filter((c) => c.required && !c.ok).map((c) => c.label);

  return {
    percent:     Math.round((filled / total) * 100),
    canFinalise: missingRequired.length === 0,
    missingRequired,
  };
}
