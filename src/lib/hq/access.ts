/**
 * Team access — who can see what.
 *
 * Two kinds of person:
 *   manager   Ryan and Lachlan (the ALLOWED_EMAILS list). Everything, plus Settings > Team.
 *   member    Anyone added in Settings > Team (e.g. the cold caller). Sees only the
 *             sections switched on for them.
 *
 * This file is pure (no database, no network) so it can be used by the
 * middleware, the sidebar and the Team screen alike, and tested on its own.
 * The same section keys are used by the database lock
 * (supabase/migrations/20261018130000_lock_database_to_team_access.sql).
 *
 * Fail closed: a URL with no rule below is managers-only, so a page added in
 * future can never be seen by a member by accident.
 */

export type SectionKey =
  | "call-list" | "motivation" | "pipeline" | "clients" | "applications" | "quote" | "sales-bible"
  | "tasks" | "calendar" | "home" | "finance" | "analytics" | "concierge" | "agents" | "settings";

export type SectionGroup = "Selling" | "Running the business" | "Money and data";

export type SectionDef = {
  key: SectionKey;
  label: string;
  group: SectionGroup;
  /** Plain-English: what switching this on lets someone see or do. */
  description: string;
  /** Worth thinking twice about (prices, client details, money). */
  sensitive?: boolean;
};

export const SECTIONS: SectionDef[] = [
  { key: "call-list", group: "Selling", label: "Call List",
    description: "The leads to call, with notes, callbacks and booking sales calls. The cold caller's main screen." },
  { key: "motivation", group: "Selling", label: "Motivation",
    description: "Call counters, streaks and the scoreboard. Its own Callback button puts events on the shared calendar, so most callers don't need it." },
  { key: "pipeline", group: "Selling", label: "Pipeline",
    description: "Every deal and the stage it's at.", sensitive: true },
  { key: "clients", group: "Selling", label: "Clients",
    description: "Client records, contact details, notes, tasks and past applications.", sensitive: true },
  { key: "applications", group: "Selling", label: "Applications",
    description: "The sales application form and everything submitted through it, including the Launch Application button.", sensitive: true },
  { key: "quote", group: "Selling", label: "Quote Builder",
    description: "The pricing calculator, with all current prices.", sensitive: true },
  { key: "sales-bible", group: "Selling", label: "Sales Bible",
    description: "The full playbook, including pricing, strategy and the objection bank.", sensitive: true },

  { key: "tasks", group: "Running the business", label: "Tasks",
    description: "Tasks and reminders. Managers see every task; everyone else sees only tasks they created or that were assigned to them." },
  { key: "calendar", group: "Running the business", label: "Calendar",
    description: "The shared calendar: every booking on it, including client calls." },
  { key: "home", group: "Running the business", label: "Home dashboard",
    description: "Pipeline funnel, upcoming meetings and tasks. Revenue only shows with Revenue and invoices." },

  { key: "finance", group: "Money and data", label: "Revenue and invoices",
    description: "Earnings, the revenue chart, and invoices on each client's page.", sensitive: true },
  { key: "analytics", group: "Money and data", label: "Analytics",
    description: "Website visitor analytics." },
  { key: "concierge", group: "Money and data", label: "Concierge",
    description: "Hotel concierge usage and settings." },
  { key: "agents", group: "Money and data", label: "Agents",
    description: "The automation agents and signed-client data behind them." },
  { key: "settings", group: "Money and data", label: "Settings",
    description: "General settings such as email snippets. Team access is always managers only." },
];

export const SECTION_KEYS: SectionKey[] = SECTIONS.map((s) => s.key);
export const SECTION_GROUPS: SectionGroup[] = ["Selling", "Running the business", "Money and data"];

export function sectionLabel(key: string): string {
  return SECTIONS.find((s) => s.key === key)?.label ?? key;
}

/** Keep only real, unique section keys, in the order they appear in SECTIONS. */
export function parseSections(input: unknown): SectionKey[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((x): x is string => typeof x === "string"));
  return SECTION_KEYS.filter((k) => wanted.has(k));
}

/* ── Presets ─────────────────────────────────────────────────────────────── */

export type Preset = { key: string; label: string; blurb: string; sections: SectionKey[] };

export const PRESETS: Preset[] = [
  { key: "caller", label: "Cold caller", sections: ["call-list", "tasks", "calendar"],
    blurb: "The Call List, their own tasks, and the shared calendar. No clients, prices or invoices." },
  { key: "caller-plus", label: "Cold caller + scoreboard", sections: ["call-list", "tasks", "calendar", "motivation"],
    blurb: "Everything above, plus the Motivation scoreboard." },
  { key: "call-list-only", label: "Call List only", sections: ["call-list"],
    blurb: "Just the Call List. Nothing else in their menu." },
  { key: "none", label: "Nothing yet", sections: [],
    blurb: "Added to the team but can't see anything until you switch sections on." },
];

export const DEFAULT_PRESET = "caller";

/* ── Who someone is ──────────────────────────────────────────────────────── */

export type Access = {
  email: string;
  name: string | null;
  role: "manager" | "member";
  /** Sections a member can see. Managers can see all of them. */
  sections: SectionKey[];
  status: "invited" | "active" | "deactivated";
  /** env = on the ALLOWED_EMAILS list (always a manager); team = a row in team_members. */
  source: "env" | "team";
};

/** What a page or URL needs: a section, "manager" (managers only), or just being signed in. */
export type Need = SectionKey | "manager" | "signed-in";

export function can(access: Access, need: Need): boolean {
  if (access.status === "deactivated") return false;
  if (access.role === "manager") return true;
  if (need === "manager") return false;
  if (need === "signed-in") return true;
  return access.sections.includes(need);
}

/* ── Which URL needs what ────────────────────────────────────────────────── */

type Rule = { path: string; exact?: boolean; methods?: string[]; need: Need };

/**
 * First match wins, so specific rules sit above general ones. A rule matches
 * its path and everything under it ("/clients" covers "/clients/123").
 */
const RULES: Rule[] = [
  // Managers only: specific things inside otherwise-open sections, and admin tools
  { path: "/settings/team", need: "manager" },
  { path: "/settings/availability", need: "manager" },
  { path: "/api/team", need: "manager" },
  { path: "/api/availability/slots", need: "call-list" },
  { path: "/api/availability", need: "manager" },
  { path: "/call-list/import", need: "manager" },
  { path: "/api/call-leads/import", need: "manager" },
  { path: "/api/call-leads/purge", need: "manager" },
  { path: "/api/call-leads/websites", need: "manager" },
  { path: "/api/call-leads", methods: ["DELETE"], need: "manager" },
  { path: "/client-portals", need: "manager" },
  { path: "/api/guru", need: "manager" },

  // Sections
  { path: "/", exact: true, need: "home" },
  { path: "/no-access", need: "signed-in" },
  { path: "/api/preview", need: "signed-in" },
  { path: "/call-list", need: "call-list" },
  { path: "/api/call-leads", need: "call-list" },
  { path: "/motivation", need: "motivation" },
  { path: "/api/motivation", need: "motivation" },
  { path: "/pipeline", need: "pipeline" },
  { path: "/clients", need: "clients" },
  { path: "/api/invoices", need: "finance" },
  { path: "/applications", need: "applications" },
  { path: "/application", need: "applications" },
  { path: "/quote", need: "quote" },
  { path: "/sales-bible", need: "sales-bible" },
  { path: "/tasks", need: "tasks" },
  { path: "/calendar", need: "calendar" },
  { path: "/analytics", need: "analytics" },
  { path: "/concierge-usage", need: "concierge" },
  { path: "/agents", need: "agents" },
  { path: "/api/agents", need: "agents" },
  { path: "/settings", need: "settings" },
];

const matches = (path: string, rule: Rule) =>
  rule.exact ? path === rule.path : path === rule.path || path.startsWith(`${rule.path}/`);

/** What a request needs. Unknown paths need a manager. */
export function routeNeed(path: string, method = "GET"): Need {
  const m = method.toUpperCase();
  const rule = RULES.find((r) => matches(path, r) && (!r.methods || r.methods.includes(m)));
  return rule ? rule.need : "manager";
}

/* ── The sidebar ─────────────────────────────────────────────────────────── */

/** Sidebar link -> what it needs. */
export const NAV_NEED: Record<string, Need> = {
  "/": "home",
  "/motivation": "motivation",
  "/call-list": "call-list",
  "/pipeline": "pipeline",
  "/clients": "clients",
  "/applications": "applications",
  "/tasks": "tasks",
  "/analytics": "analytics",
  "/concierge-usage": "concierge",
  "/agents": "agents",
  "/quote": "quote",
  "/sales-bible": "sales-bible",
  "/client-portals": "manager",
  "/calendar": "calendar",
  "/settings": "settings",
};

/** Where to send someone who isn't allowed where they went: their first available screen. */
const LANDING_ORDER = [
  "/", "/call-list", "/motivation", "/tasks", "/calendar", "/pipeline", "/clients",
  "/applications", "/quote", "/sales-bible", "/analytics", "/concierge-usage", "/agents", "/settings",
];

export function landingPath(access: Access): string {
  const first = LANDING_ORDER.find((href) => can(access, NAV_NEED[href] ?? "manager"));
  return first ?? "/no-access";
}

/** Cookie that holds who a manager is previewing as. Ignored unless the signed-in person is really a manager. */
export const PREVIEW_COOKIE = "ivory_preview_as";

/* ── Small helpers ───────────────────────────────────────────────────────── */

export const normalizeEmail = (s: unknown): string => String(s ?? "").trim().toLowerCase();

export function isValidEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(s);
}

/** True when a database error means a table or function from the access migrations isn't there yet. */
export function isMissingAccessSetup(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" || error.code === "42883" || error.code === "PGRST205" || error.code === "PGRST202" ||
    /does not exist|schema cache|could not find the (table|function)/i.test(error.message ?? "")
  );
}
