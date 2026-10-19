/**
 * Drives the REAL middleware with fake sign-ins (a founder, Jan, a switched-off user, a stranger) and checks every outcome: allowed, redirected, 403, signed out.
 *
 * Run from the repo root:  npx tsx scripts/checks/middleware.check.ts
 * Prints a pass/fail count; any FAIL line means an access rule changed.
 */
process.env.ALLOWED_EMAILS = "lachlan@agentivory.com, ryan@agentivory.com";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

// ── Stand in for Supabase: who is signed in, and what the team table says
const state: { user: string | null; rows: Record<string, any>; dbError: boolean; dbLookups: number; signedOut: boolean } =
  { user: null, rows: {}, dbError: false, dbLookups: 0, signedOut: false };
const fakeClient = (opts: any) => ({
  auth: {
    getUser: async () => ({ data: { user: state.user ? { email: state.user } : null } }),
    signOut: async () => { state.signedOut = true; state.user = null; opts.cookies.setAll([{ name: "sb-session", value: "", options: { maxAge: 0 } }]); },
  },
  from: (t: string) => ({
    select: () => ({
      eq: (col: string, value: string) => ({
        maybeSingle: async () => {
          state.dbLookups++;
          if (state.dbError) return { data: null, error: { code: "XX000", message: "connection reset" } };
          const row = col === "id" ? Object.values(state.rows).find((r: any) => r.id === value) : state.rows[value];
          return { data: row ?? null, error: null };
        },
      }),
    }),
  }),
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ssr = require.resolve("@supabase/ssr");
require.cache[ssr] = { id: ssr, filename: ssr, loaded: true, exports: { createServerClient: (_u: string, _k: string, opts: any) => fakeClient(opts) } } as any;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NextRequest } = require("next/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { middleware } = require("../../src/middleware");

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { if (c) passes++; else { fails++; console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d)); } };

async function hit(path: string, { method = "GET", host = "crm.agentivory.com", cookie }: { method?: string; host?: string; cookie?: string } = {}) {
  state.signedOut = false;
  const res = await middleware(new NextRequest(`https://${host}${path}`, { method, headers: { host, ...(cookie ? { cookie } : {}) } }));
  const loc = res.headers.get("location");
  const passed = res.status === 200 && res.headers.get("x-middleware-next") === "1";
  let json: any = null; try { if (res.headers.get("content-type")?.includes("json")) json = await res.clone().json(); } catch {}
  return { status: res.status, redirect: loc ? new URL(loc).pathname + new URL(loc).search : null, passed, json, cookies: res.cookies.getAll() };
}
const asUser = (email: string | null) => { state.user = email; state.dbLookups = 0; };

const JAN = "jan@agentivory.com";
(async () => {
  state.rows[JAN] = { id: "11111111-1111-4111-8111-111111111111", email: JAN, name: "Jan", role: "member", sections: ["call-list"], status: "invited" };
  state.rows["old@agentivory.com"] = { email: "old@agentivory.com", name: "Old", role: "member", sections: ["call-list", "clients"], status: "deactivated" };
  state.rows["empty@agentivory.com"] = { email: "empty@agentivory.com", name: "Empty", role: "member", sections: [], status: "active" };

  // ── signed out
  asUser(null);
  let r = await hit("/pipeline");
  ok("signed out -> /login", r.redirect === "/login", r);
  for (const p of ["/login", "/auth/callback", "/api/ingest", "/api/track", "/track.js", "/concierge/ivory-suites", "/api/concierge/chat", "/client/abc123", "/api/jobs/9/complete", "/api/justcall/webhook"]) {
    r = await hit(p, { method: "POST" });
    ok(`public ${p} stays public`, r.passed, r);
  }

  // ── founders
  for (const f of ["lachlan@agentivory.com", "Ryan@Agentivory.com"]) {
    asUser(f);
    for (const p of ["/", "/pipeline", "/clients/1", "/settings/team", "/call-list/import", "/api/team", "/api/invoices", "/some-future-page"]) {
      r = await hit(p, { method: p.startsWith("/api") ? "POST" : "GET" });
      ok(`founder ${f} reaches ${p}`, r.passed, r);
    }
    ok(`founder ${f} costs no database lookups`, state.dbLookups === 0, state.dbLookups);
  }

  // ── JAN: invited, Call List only
  asUser(JAN);
  r = await hit("/call-list");        ok("JAN opens the Call List", r.passed, r);
  r = await hit("/api/call-leads");   ok("JAN uses the lead list API", r.passed, r);
  r = await hit("/api/call-leads/abc/outcome", { method: "POST" }); ok("JAN logs a call outcome", r.passed, r);
  r = await hit("/api/call-leads/abc/notes"); ok("JAN reads notes", r.passed, r);
  ok("JAN's check is one cheap lookup per request", state.dbLookups === 4, state.dbLookups);
  const pages = ["/", "/pipeline", "/clients", "/clients/42", "/applications", "/application/new", "/tasks", "/calendar", "/quote", "/sales-bible", "/analytics", "/concierge-usage", "/agents", "/settings", "/settings/team", "/motivation", "/client-portals", "/call-list/import", "/some-future-page"];
  for (const p of pages) { r = await hit(p); ok(`JAN is sent away from ${p} -> his Call List`, r.redirect === "/call-list", r); }
  r = await hit("/clients/42", { method: "POST" }); ok("JAN can't POST a form to a client page either (server action)", r.redirect === "/call-list", r);
  const apis: [string, string][] = [["/api/invoices", "POST"], ["/api/invoices/1/file", "GET"], ["/api/invoices/parse", "POST"], ["/api/motivation/booked", "POST"], ["/api/motivation/callback", "POST"], ["/api/motivation/log", "POST"], ["/api/agents/run", "POST"], ["/api/team", "GET"], ["/api/team", "POST"], ["/api/team/x", "PATCH"], ["/api/guru", "POST"], ["/api/call-leads/import", "POST"], ["/api/call-leads/purge", "POST"], ["/api/call-leads/websites", "POST"], ["/api/call-leads/abc", "DELETE"]];
  for (const [p, m] of apis) { r = await hit(p, { method: m }); ok(`JAN gets 403 JSON from ${m} ${p}`, r.status === 403 && r.json?.error === "You don't have access to this.", r); }
  ok("JAN was never signed out by any of that", state.user === JAN);

  // ── toggles take effect on the very next request
  state.rows[JAN].sections = ["call-list", "clients"];
  r = await hit("/clients/42"); ok("granting 'clients' opens /clients immediately", r.passed, r);
  r = await hit("/api/invoices"); ok("...but still not invoices", r.status === 403, r);
  state.rows[JAN].sections = ["call-list", "clients", "finance"];
  r = await hit("/api/invoices"); ok("granting 'finance' opens invoices", r.passed, r);
  state.rows[JAN].sections = ["call-list"];
  r = await hit("/clients/42"); ok("revoking closes it again immediately", r.redirect === "/call-list", r);
  state.rows[JAN].sections = ["motivation"];
  r = await hit("/"); ok("with different sections, 'home' redirects to a screen he does have", r.redirect === "/motivation", r);
  r = await hit("/call-list"); ok("...and the Call List is now closed to him", r.redirect === "/motivation", r);
  state.rows[JAN].sections = ["call-list"];

  // ── nothing switched on
  asUser("empty@agentivory.com");
  r = await hit("/"); ok("no sections -> /no-access", r.redirect === "/no-access", r);
  r = await hit("/no-access"); ok("/no-access itself is reachable (no loop)", r.passed, r);
  r = await hit("/pipeline"); ok("no sections -> anywhere else goes to /no-access", r.redirect === "/no-access", r);

  // ── switched off / not on the team: signed out on the spot
  asUser("old@agentivory.com");
  r = await hit("/call-list");
  ok("SWITCHED OFF: signed out and sent to the sign-in page with the 'not allowed' error", state.signedOut && r.redirect === "/login?error=not_allowed", { signedOut: state.signedOut, r });
  ok("...and the session cookie is cleared on that response", r.cookies.some((c: any) => c.name === "sb-session" && (c.value === "" || c.maxAge === 0)), r.cookies);
  asUser(JAN); state.rows[JAN].status = "deactivated";
  r = await hit("/api/call-leads");
  ok("switching Jan off mid-session cuts him off on the next request, API too", state.signedOut && r.redirect === "/login?error=not_allowed", r);
  state.rows[JAN].status = "active";
  asUser("stranger@gmail.com");
  r = await hit("/call-list");
  ok("A STRANGER signed in with Google but not on the team is signed out", state.signedOut && r.redirect === "/login?error=not_allowed", r);
  asUser("stranger@gmail.com");
  r = await hit("/", { method: "POST" });
  ok("...for any request, any method", state.signedOut && r.redirect === "/login?error=not_allowed", r);

  // ── database hiccup: deny, but don't sign anyone out
  asUser(JAN); state.dbError = true;
  r = await hit("/call-list");
  ok("DB error: 503, access denied, but NOT signed out", r.status === 503 && !state.signedOut && state.user === JAN, r);
  asUser("lachlan@agentivory.com");
  r = await hit("/pipeline");
  ok("DB error: founders are unaffected (no lookup needed)", r.passed, r);
  state.dbError = false;

  // ── the public hotel host is untouched
  asUser(null);
  r = await hit("/ivory-suites", { host: "concierge.agentivory.com" }); ok("concierge host serves guests with no sign-in", r.passed, r);
  r = await hit("/call-list", { host: "concierge.agentivory.com" }); ok("concierge host still 404s the internal Call List", r.status === 404, r);
  r = await hit("/api/call-leads", { host: "concierge.agentivory.com" }); ok("...and its API", r.status === 404, r);
  r = await hit("/api/justcall/webhook", { host: "concierge.agentivory.com", method: "POST" }); ok("...and the JustCall webhook is only on the CRM host", r.status === 404, r);
  asUser(null);
  r = await hit("/api/justcall/recording/abc"); ok("signed out: recordings are NOT public (only the webhook is)", r.redirect === "/login", r);
  r = await hit("/api/justcall/status"); ok("signed out: the JustCall status is not public either", r.redirect === "/login", r);


  // ── a manager previewing as Jan is held to Jan's rules
  const PREVIEW = "ivory_preview_as=11111111-1111-4111-8111-111111111111";
  asUser("lachlan@agentivory.com");
  r = await hit("/pipeline", { cookie: PREVIEW });
  ok("PREVIEW: a founder previewing Jan is sent away from /pipeline just as Jan would be", r.redirect === "/call-list", r);
  r = await hit("/", { cookie: PREVIEW });
  ok("PREVIEW: ...and from Home, to Jan's Call List", r.redirect === "/call-list", r);
  r = await hit("/settings/team", { cookie: PREVIEW });
  ok("PREVIEW: the Team screen is closed while previewing (exit first)", r.redirect === "/call-list", r);
  r = await hit("/call-list", { cookie: PREVIEW });
  ok("PREVIEW: Jan's own screen opens", r.passed, r);
  r = await hit("/api/invoices", { method: "POST", cookie: PREVIEW });
  ok("PREVIEW: APIs Jan can't use answer 403 too", r.status === 403, r);
  r = await hit("/api/preview", { method: "DELETE", cookie: PREVIEW });
  ok("PREVIEW: the exit button's request is allowed", r.passed, r);
  r = await hit("/api/preview", { method: "POST", cookie: PREVIEW });
  ok("PREVIEW: switching preview to someone else is allowed", r.passed, r);
  r = await hit("/pipeline");
  ok("after exiting (no cookie) the founder has everything again", r.passed, r);
  state.rows[JAN].sections = ["call-list", "tasks", "calendar"];
  r = await hit("/tasks", { cookie: PREVIEW });
  ok("PREVIEW follows Jan's current toggles: Tasks now opens", r.passed, r);
  r = await hit("/clients", { cookie: PREVIEW });
  ok("...but Clients still doesn't", r.redirect === "/call-list", r);
  state.rows[JAN].sections = ["call-list"];
  r = await hit("/pipeline", { cookie: "ivory_preview_as=55555555-5555-4555-8555-555555555555" });
  ok("a preview of someone who doesn't exist is dropped: founder carries on, and the stale cookie is cleared", r.passed && r.cookies.some((c: any) => c.name === "ivory_preview_as" && (c.value === "" || c.maxAge === 0 || c.expires)), r);
  r = await hit("/pipeline", { cookie: "ivory_preview_as=not-a-uuid" });
  ok("a junk preview cookie is ignored", r.passed, r);
  state.rows[JAN].status = "deactivated";
  r = await hit("/pipeline", { cookie: PREVIEW });
  ok("previewing someone switched off is ignored", r.passed, r);
  state.rows[JAN].status = "active";

  // ── a team member can NOT use a preview cookie to see more
  asUser(JAN);
  state.rows["sam@agentivory.com"] = { id: "44444444-4444-4444-8444-444444444444", email: "sam@agentivory.com", name: "Sam", role: "member", sections: ["pipeline", "clients", "finance"], status: "active" };
  r = await hit("/pipeline", { cookie: "ivory_preview_as=44444444-4444-4444-8444-444444444444" });
  ok("JAN sending a cookie to preview SAM still can't open Pipeline", r.redirect === "/call-list", r);
  r = await hit("/api/invoices", { method: "POST", cookie: "ivory_preview_as=44444444-4444-4444-8444-444444444444" });
  ok("...or the invoices API", r.status === 403, r);
  console.log(`\n${passes} passed, ${fails} failed`);
})();

export {};
