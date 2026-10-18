/**
 * Checks the rules for which URL needs which section (src/lib/hq/access.ts): what a cold caller can and can't reach, fail-closed defaults, landing pages.
 *
 * Run from the repo root:  npx tsx scripts/checks/access.check.ts
 * Prints a pass/fail count; any FAIL line means an access rule changed.
 */
process.env.ALLOWED_EMAILS = "lachlan@agentivory.com, Ryan@agentivory.com";
import { can, landingPath, routeNeed, parseSections, PRESETS, NAV_NEED, SECTION_KEYS, isValidEmail, normalizeEmail, type Access, type SectionKey } from "../../src/lib/hq/access";

let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

const member = (sections: SectionKey[], status: Access["status"] = "active"): Access => ({ email: "jan@agentivory.com", name: "Jan", role: "member", sections, status, source: "team" });
const manager: Access = { email: "lachlan@agentivory.com", name: null, role: "manager", sections: [...SECTION_KEYS], status: "active", source: "env" };
const jan = member(["call-list"]);
const allows = (a: Access, path: string, method = "GET") => can(a, routeNeed(path, method));

// ── Jan (Call List only): what he CAN reach
for (const p of ["/call-list", "/call-list/", "/api/call-leads", "/api/call-leads/abc/notes", "/api/call-leads/abc/outcome", "/no-access"]) eq(`jan may open ${p}`, allows(jan, p), true);
eq("jan may POST outcomes", allows(jan, "/api/call-leads/abc/outcome", "POST"), true);
eq("jan may GET the list", allows(jan, "/api/call-leads", "GET"), true);

// ── Jan: everything he must NOT reach
const blocked = [
  "/", "/pipeline", "/clients", "/clients/123", "/applications", "/application/new", "/application/9", "/tasks", "/calendar", "/quote",
  "/sales-bible", "/analytics", "/concierge-usage", "/agents", "/settings", "/settings/team", "/motivation", "/client-portals",
  "/call-list/import", "/api/invoices", "/api/invoices/1/file", "/api/invoices/parse", "/api/motivation/booked", "/api/motivation/log",
  "/api/motivation/callback", "/api/agents/run", "/api/team", "/api/team/xyz", "/api/guru",
  "/api/call-leads/import", "/api/call-leads/purge", "/api/call-leads/websites",
];
for (const p of blocked) eq(`jan BLOCKED from ${p}`, allows(jan, p, p.startsWith("/api") ? "POST" : "GET"), false);
eq("jan BLOCKED from deleting a lead (DELETE)", allows(jan, "/api/call-leads/abc", "DELETE"), false);
eq("...but not blocked from reading it (GET)", allows(jan, "/api/call-leads/abc", "GET"), true);
eq("lower-case method works too", can(jan, routeNeed("/api/call-leads/abc", "delete")), false);

// ── Fail closed: unknown URLs are managers-only
for (const p of ["/brand-new-page", "/reports", "/api/new-thing", "/settings-backup", "/clientsXYZ", "/call-listing"]) eq(`unknown ${p} is managers-only`, [allows(jan, p), allows(manager, p)], [false, true]);
eq("prefix is segment-aware: /call-listing is NOT the call list", routeNeed("/call-listing"), "manager");
eq("prefix is segment-aware: /application vs /applications both need applications", [routeNeed("/application/new"), routeNeed("/applications")], ["applications", "applications"]);

// ── Managers reach everything
for (const p of [...blocked, "/call-list", "/brand-new-page"]) eq(`manager reaches ${p}`, allows(manager, p, p.startsWith("/api") ? "POST" : "GET"), true);
eq("manager can DELETE a lead", allows(manager, "/api/call-leads/abc", "DELETE"), true);

// ── Granting sections opens exactly those
const sam = member(["tasks", "clients"]);
eq("sam sees tasks + clients", [allows(sam, "/tasks"), allows(sam, "/clients/9")], [true, true]);
eq("sam still cannot see invoices (finance), calendar, pipeline, home", [allows(sam, "/api/invoices"), allows(sam, "/calendar"), allows(sam, "/pipeline"), allows(sam, "/")], [false, false, false, false]);
eq("adding finance opens invoices", allows(member(["clients", "finance"]), "/api/invoices/1/file"), true);
eq("'settings' does NOT open the Team screen", [allows(member(["settings"]), "/settings"), allows(member(["settings"]), "/settings/team"), allows(member(["settings"]), "/api/team")], [true, false, false]);
eq("'home' alone does not open revenue API", allows(member(["home"]), "/api/invoices"), false);

// ── Switched-off people can do nothing, even with sections
const off = member(["call-list", "clients"], "deactivated");
eq("deactivated member cannot reach even /no-access or the call list", [can(off, "signed-in"), allows(off, "/call-list")], [false, false]);
eq("an invited (never signed in) member still works", allows(member(["call-list"], "invited"), "/call-list"), true);
eq("a manager flagged deactivated is blocked too", can({ ...manager, status: "deactivated" }, "home"), false);

// ── Where people land
eq("manager lands on Home", landingPath(manager), "/");
eq("Jan lands on the Call List", landingPath(jan), "/call-list");
eq("member with only Motivation lands there", landingPath(member(["motivation"])), "/motivation");
eq("member with nothing lands on /no-access", landingPath(member([])), "/no-access");
eq("member with home lands on /", landingPath(member(["home", "call-list"])), "/");
eq("Jan never lands somewhere he can't open", can(jan, routeNeed(landingPath(jan))), true);
eq("/no-access is always reachable once signed in", can(member([]), routeNeed("/no-access")), true);

// ── Sidebar: exactly the links Jan may use
const links = Object.keys(NAV_NEED).filter((h) => can(jan, NAV_NEED[h]));
eq("Jan's sidebar is just the Call List", links, ["/call-list"]);
eq("Manager's sidebar is everything", Object.keys(NAV_NEED).filter((h) => can(manager, NAV_NEED[h])).length, Object.keys(NAV_NEED).length);
eq("every sidebar link has a rule that agrees with it", Object.entries(NAV_NEED).every(([h, n]) => routeNeed(h) === n), true);

// ── Presets and parsing
eq("Cold caller preset is just the Call List", PRESETS.find((p) => p.key === "caller")!.sections, ["call-list"]);
eq("every preset only uses real sections", PRESETS.every((p) => p.sections.every((s) => SECTION_KEYS.includes(s))), true);
eq("parseSections drops junk and duplicates, keeps canonical order", parseSections(["finance", "nope", "call-list", "call-list", 7, null]), ["call-list", "finance"]);
eq("parseSections of garbage", [parseSections(null), parseSections("call-list"), parseSections({})], [[], [], []]);
eq("normalizeEmail", normalizeEmail("  Jan@Agentivory.COM "), "jan@agentivory.com");
eq("emails", [isValidEmail("jan@agentivory.com"), isValidEmail("jan@"), isValidEmail("jan agentivory.com"), isValidEmail("a@b.c"), isValidEmail("a@b.co")], [true, false, false, false, true]);
console.log(`\n${passes} passed, ${fails} failed`);
