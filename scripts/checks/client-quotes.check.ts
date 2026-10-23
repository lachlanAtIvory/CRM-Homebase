/**
 * Checks quotes that belong to a client, and the push from a quote to that client's application
 * (src/lib/hq/offerings.ts, quote-to-application.ts, client-quotes.ts):
 * which products a quote means, what gets copied to the application, what is left alone,
 * and the picker's search.
 *
 * Run from the repo root:  npx tsx scripts/checks/client-quotes.check.ts
 */
import { CORE_ORDER, UPSELLS, defaultState, type QuoteState } from "../../src/lib/hq/quote-config";
import { computeQuote } from "../../src/lib/hq/quote-math";
import { OFFERINGS, findOffering, isOfferingKey, offeringGroups } from "../../src/lib/hq/offerings";
import { applicationPatchFromQuote, productKeysFromQuote, readSnapshot, summarizeQuote } from "../../src/lib/hq/quote-to-application";
import { friendlyError, openClientQuote, pushQuoteToApplication, saveClientQuote, searchClients } from "../../src/lib/hq/client-quotes";

type Row = Record<string, any>;
let fails = 0, passes = 0;
const eq = (n: string, g: unknown, w: unknown) => { if (JSON.stringify(g) === JSON.stringify(w)) passes++; else { fails++; console.log("FAIL", n, "\n  got ", JSON.stringify(g), "\n  want", JSON.stringify(w)); } };

const quote = (over: (s: QuoteState) => void = () => {}): QuoteState => { const s = defaultState(); s.clinic = "Neutral Bay Dental"; over(s); return s; };

// ── 1. The product list the application form shows
eq("every core product and every add-on is an offering, once", OFFERINGS.map((o) => o.key), [...CORE_ORDER, ...UPSELLS.map((u) => u.id)]);
eq("offering keys are unique", new Set(OFFERINGS.map((o) => o.key)).size, OFFERINGS.length);
eq("an offering is found by its key", [findOffering("inbound")?.label, findOffering("dm")?.label, findOffering("outbound")?.label, findOffering("guru")?.group], ["Inbound calls", "Social media DMs", "Form to outbound", "eff"]);
eq("the old catalogue's keys are not offerings (the form looks those up separately)", ["agent_ivory", "webchat", "outreach", "email_agent", "report_gen", "calendar_sync"].map(isOfferingKey), Array(6).fill(false));
eq("offerings come in three groups, core first", offeringGroups().map((g) => [g.group, g.items.length > 0]), [["core", true], ["rev", true], ["eff", true]]);
eq("the groups together hold every offering", offeringGroups().flatMap((g) => g.items).length, OFFERINGS.length);

// ── 2. Which products a quote means
eq("a blank quote builds inbound calls", productKeysFromQuote(defaultState()), ["inbound"]);
eq("all three core products, in the quote's order", productKeysFromQuote(quote((s) => { for (const k of CORE_ORDER) s.core[k].state = "new"; })), ["inbound", "dm", "outbound"]);
eq("a core product already live at the clinic is not something to build", productKeysFromQuote(quote((s) => { s.core.inbound.state = "live"; s.core.dm.state = "new"; })), ["dm"]);
eq("nothing selected means nothing to build", productKeysFromQuote(quote((s) => { s.core.inbound.state = "off"; })), []);
eq("add-ons that apply are included after the core products", productKeysFromQuote(quote((s) => { s.upsells.treatment = true; s.upsells.backfill = true; })), ["inbound", "treatment", "backfill"]);
eq("an add-on that doesn't suit this clinic type is left out (post-consult nurture is for cosmetic work)", productKeysFromQuote(quote((s) => { s.type = "physio"; s.upsells.nurture = true; })), ["inbound"]);
eq("...but is included when the clinic type suits", productKeysFromQuote(quote((s) => { s.type = "cosdental"; s.upsells.nurture = true; })), ["inbound", "nurture"]);
eq("an add-on that needs the practice software is left out when it can't be integrated", productKeysFromQuote(quote((s) => { s.pms = "no"; s.upsells.treatment = true; s.upsells.guru = true; })), ["inbound", "guru"]);
eq("an add-on switched off is left out", productKeysFromQuote(quote((s) => { s.upsells.treatment = false; })), ["inbound"]);

// ── 3. The summary kept with the application
{
  const s = quote((q) => {
    q.type = "cosdental"; q.practitioners = "4"; q.pms = "yes"; q.pmsName = "  Dental4Windows ";
    q.core.inbound.state = "new"; q.core.outbound.state = "new"; q.core.dm.state = "live";
    q.upsells.nurture = true; q.upsells.reactivation = true;
    q.locations = [{ id: "l1", name: "", practitioners: "9.4" }];
    q.offers = [{ id: "o1", name: " Whitening $299 ", kind: "mid" }];
    q.leads = " 40 a month "; q.notes = " Owner wants calls answered after 5pm "; q.gst = true; q.term = "12";
  });
  const sum = summarizeQuote(s), r = computeQuote(s);
  eq("the summary's totals are the quote engine's, excluding GST", [sum.setupTotal, sum.monthlyTotal], [r.setupTotal, r.monthlyTotal]);
  eq("clinic facts: type, tier, band, practitioners, channels", [sum.clinicType, sum.clinicTypeLabel, sum.tier, sum.tierLabel, sum.band, sum.practitioners, sum.channels], ["cosdental", "Cosmetic dental", "practice", "Practice", "high", 4, 3]);
  eq("practice software is trimmed and says whether it integrates", sum.pms, { name: "Dental4Windows", integrates: true });
  eq("core products keep their status (live ones are listed but marked)", sum.core, [{ key: "inbound", label: "Inbound calls", status: "new" }, { key: "dm", label: "Social media DMs", status: "live" }, { key: "outbound", label: "Form to outbound", status: "new" }]);
  eq("add-ons are listed by name", sum.upsells.map((u) => u.key), ["nurture", "reactivation"]);
  eq("an unnamed extra location gets a name, and its size is a whole number", sum.locations, [{ name: "Extra location", practitioners: 9 }]);
  eq("ad offers are carried when form-to-outbound is in the quote", sum.offers, [{ name: "Whitening $299", kind: "mid", kindLabel: "Offer $200 to $500" }]);
  eq("GST flag, term, leads and notes", [sum.gst, sum.term, sum.leadsPerMonth, sum.notes], [true, "12", "40 a month", "Owner wants calls answered after 5pm"]);
  eq("the priced lines come through for display", [sum.setup.length > 0, sum.monthly.length > 0, sum.runs.length > 0, sum.fees.length > 0], [true, true, true, true]);
  const noOut = summarizeQuote(quote((q) => { q.core.outbound.state = "off"; q.offers = [{ id: "o1", name: "Old offer", kind: "low" }]; }));
  eq("offers are left out when there is no form-to-outbound", noOut.offers, []);
}

// ── 4. What a push writes onto the application
{
  const s = quote((q) => { q.core.dm.state = "new"; q.upsells.guru = true; });
  const p = applicationPatchFromQuote(s, new Date("2026-10-23T05:00:00Z"));
  const r = computeQuote(s);
  eq("products to build", p.selected_products, ["inbound", "dm", "guru"]);
  eq("price, ex GST, to the cent", [p.upfront_total_aud, p.monthly_total_aud], [Math.round(r.setupTotal * 100) / 100, Math.round(r.monthlyTotal * 100) / 100]);
  eq("pushed time", p.quote_pushed_at, "2026-10-23T05:00:00.000Z");
  eq("the quote itself travels with it", [p.quote_snapshot.state.clinic, p.quote_snapshot.summary.clinic, readSnapshot(p.quote_snapshot) !== null], ["Neutral Bay Dental", "Neutral Bay Dental", true]);
  eq("a snapshot read back: only ours are accepted", [readSnapshot(null), readSnapshot("x"), readSnapshot([]), readSnapshot({}), readSnapshot({ state: {}, summary: {} }) !== null], [null, null, null, null, true]);
  const odd = applicationPatchFromQuote(quote((q) => { q.practitioners = "3"; q.pms = "no"; }), new Date());
  eq("cents are rounded", Number.isInteger(odd.upfront_total_aud * 100) && Number.isInteger(odd.monthly_total_aud * 100), true);
}

// ── 5. Against an in-memory database
let seq = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 23, 0, 0, ++seq)).toISOString();
function makeDb(seed: Record<string, Row[]> = {}, opts: { missing?: string[] } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const missing = (t: string) => (opts.missing ?? []).includes(t);
  class Q {
    mode = "select"; payload: any; f: ((r: Row) => boolean)[] = []; ord: [string, boolean][] = []; lim = Infinity; one: "single" | "maybe" | null = null;
    constructor(public t: string) {}
    select() { return this; }
    insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
    update(p: any) { this.mode = "update"; this.payload = p; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    in(c: string, vs: any[]) { this.f.push((r) => vs.includes(r[c])); return this; }
    ilike(c: string, pat: string) { const needle = pat.replace(/%/g, "").toLowerCase(); this.f.push((r) => String(r[c] ?? "").toLowerCase().includes(needle)); return this; }
    order(c: string, o?: any) { this.ord.push([c, o?.ascending !== false]); return this; }
    limit(x: number) { this.lim = x; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run(): any {
      if (missing(this.t)) return { data: null, error: { message: `relation "public.${this.t}" does not exist` } };
      const rows = (tables[this.t] ??= []);
      if (this.mode === "insert") {
        if (this.t === "client_quotes" && rows.some((r) => r.client_id === this.payload.client_id)) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        const row = { id: `${this.t}-${++n}`, created_at: stamp(), updated_at: stamp(), ...this.payload };
        rows.push(row); return this.fin([row]);
      }
      let hit = rows.filter((r) => this.f.every((g) => g(r)));
      if (this.mode === "update") { hit.forEach((r) => Object.assign(r, this.payload, { updated_at: stamp() })); return this.fin(hit); }
      for (const [c, asc] of [...this.ord].reverse()) hit = [...hit].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      return this.fin(hit.slice(0, this.lim));
    }
    fin(rs: Row[]) {
      const out = rs.map((r) => JSON.parse(JSON.stringify(r)));
      if (this.one) return out.length ? { data: out[0], error: null } : this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out, error: null };
    }
  }
  return { tables, from: (t: string) => new Q(t) } as any;
}

const CLIENT = "c-neutral";
const seed = () => ({
  clients: [
    { id: CLIENT, company_name: "Neutral Bay Dental Surgery", contact_name: "Dr Kim", email: "kim@nbd.example", phone: "0299990000", updated_at: "2026-10-20T00:00:00Z" },
    { id: "c-breeze", company_name: "Breeze Physio", contact_name: null, email: null, phone: null, updated_at: "2026-10-22T00:00:00Z" },
    { id: "c-old", company_name: "Old Chiro", contact_name: null, email: null, phone: null, updated_at: "2026-09-01T00:00:00Z" },
  ],
});

(async () => {
  // search
  let db = makeDb({
    ...seed(),
    deals: [{ client_id: CLIENT, current_stage: "quoted", created_at: "2026-10-01" }, { client_id: CLIENT, current_stage: "call_booked", created_at: "2026-09-01" }, { client_id: "c-breeze", current_stage: "call_booked", created_at: "2026-10-22" }],
    client_quotes: [{ client_id: CLIENT }],
    applications: [{ id: "a-old", client_id: CLIENT, updated_at: "2026-10-10" }, { id: "a-new", client_id: CLIENT, updated_at: "2026-10-15" }],
  });
  let s = await searchClients(db, "");
  eq("search with no text: most recently touched client first", s.ok && s.clients.map((c) => c.id), ["c-breeze", CLIENT, "c-old"]);
  eq("...with pipeline stage, whether a quote exists, and the latest application", s.ok && s.clients.map((c) => [c.stage, c.hasQuote, c.applicationId]), [["call_booked", false, null], ["quoted", true, "a-new"], [null, false, null]]);
  s = await searchClients(db, "dental");
  eq("search by name, any case", s.ok && s.clients.map((c) => c.company_name), ["Neutral Bay Dental Surgery"]);
  s = await searchClients(db, "x%,y)(\"'`*\\");
  eq("search text with filter characters can't break the query", s.ok, true);
  s = await searchClients(db, "zzz");
  eq("nothing found is an empty list, not an error", s.ok && s.clients, []);
  s = await searchClients(makeDb({ ...seed() }, { missing: ["client_quotes"] }), "");
  eq("before the migration the picker still works (just no quote marks)", s.ok && s.clients.every((c) => c.hasQuote === false), true);
  s = await searchClients(makeDb({ ...seed() }, { missing: ["clients"] }), "");
  eq("a database failure is reported", !s.ok, true);

  // open
  db = makeDb(seed());
  let o = await openClientQuote(db, CLIENT);
  eq("a client with no quote opens blank, with their details", o.ok && [o.view.client.company_name, o.view.client.contact_name, o.view.state, o.view.application], ["Neutral Bay Dental Surgery", "Dr Kim", null, null]);
  o = await openClientQuote(db, "nope");
  eq("an unknown client is a clear error", !o.ok && /no longer exists/.test(o.error), true);

  // save
  const q1 = quote((q) => { q.practitioners = "5"; q.upsells.guru = true; });
  let sv = await saveClientQuote(db, CLIENT, q1, "lachlan@agentivory.com");
  eq("saving a quote for a client", [sv.ok, db.tables.client_quotes.length, db.tables.client_quotes[0].client_id, db.tables.client_quotes[0].updated_by], [true, 1, CLIENT, "lachlan@agentivory.com"]);
  eq("...keeps the headline beside it", [db.tables.client_quotes[0].summary.setupTotal, db.tables.client_quotes[0].summary.upsells.map((u: Row) => u.key)], [computeQuote(q1).setupTotal, ["guru"]]);
  sv = await saveClientQuote(db, CLIENT, quote((q) => { q.practitioners = "9"; }), "ryan@agentivory.com");
  eq("saving again replaces it (one live quote per client)", [db.tables.client_quotes.length, db.tables.client_quotes[0].state.practitioners, db.tables.client_quotes[0].updated_by], [1, "9", "ryan@agentivory.com"]);
  o = await openClientQuote(db, CLIENT);
  eq("the saved quote opens again, as saved", o.ok && [o.view.state?.practitioners, o.view.state?.clinic, o.view.updatedBy], ["9", "Neutral Bay Dental", "ryan@agentivory.com"]);
  sv = await saveClientQuote(db, CLIENT, { core: "junk", practitioners: { evil: true }, type: "<script>", upsells: [1, 2] }, null);
  eq("junk sent from the browser becomes a safe quote instead of being stored raw", [sv.ok, db.tables.client_quotes[0].state.type, typeof db.tables.client_quotes[0].state.practitioners], [true, "physio", "string"]);
  sv = await saveClientQuote(db, "ghost", q1, null);
  eq("saving against an unknown client is refused", !sv.ok && /no longer exists/.test(sv.error), true);
  sv = await saveClientQuote(makeDb(seed(), { missing: ["client_quotes"] }), CLIENT, q1, null);
  eq("before the migration: a plain-words setup message, not a database error", !sv.ok && /One setup step left/.test(sv.error) && /20261023140000_add_client_quotes/.test(sv.error), true);
  eq("friendlyError leaves other errors alone", [friendlyError("permission denied", "x"), friendlyError(undefined, "fallback")], ["permission denied", "fallback"]);

  // push: a client with no application yet
  db = makeDb(seed());
  const NOW = new Date("2026-10-23T05:00:00Z");
  const pushQ = quote((q) => { q.type = "gendental"; q.practitioners = "3"; q.pmsName = "Dental4Windows"; q.core.dm.state = "new"; q.upsells.guru = true; });
  let p = await pushQuoteToApplication(db, CLIENT, pushQ, "lachlan@agentivory.com", NOW);
  const app = db.tables.applications?.[0];
  eq("push starts the client's application", [p.ok, p.ok && p.created, db.tables.applications.length, app.client_id, app.status], [true, true, 1, CLIENT, "draft"]);
  eq("...with the client's details", [app.company_name, app.owner_name, app.contact_email, app.contact_phone], ["Neutral Bay Dental Surgery", "Dr Kim", "kim@nbd.example", "0299990000"]);
  eq("...the products, the price and the practice software from the quote", [app.selected_products, app.upfront_total_aud, app.monthly_total_aud, app.booking_platform_name], [["inbound", "dm", "guru"], Math.round(computeQuote(pushQ).setupTotal * 100) / 100, Math.round(computeQuote(pushQ).monthlyTotal * 100) / 100, "Dental4Windows"]);
  eq("...and the quote kept with it", [app.quote_snapshot.summary.clinicTypeLabel, app.quote_pushed_at], ["General dental", "2026-10-23T05:00:00.000Z"]);
  eq("pushing also saves the quote against the client", [db.tables.client_quotes.length, db.tables.client_quotes[0].client_id], [1, CLIENT]);
  eq("the push says how many products it carried", p.ok && p.products, 3);

  // push again after the application has been worked on
  Object.assign(db.tables.applications[0], { goals: "More new patients", requirements: "Book into D4W", team_members: [{ name: "Dr Kim" }], services: [{ id: "s1", name: "Check-up" }], owner_name: "Dr Kimberley Lee", booking_platform_name: "Typed By Hand", status: "submitted", discount_percent: 10 });
  const pushQ2 = quote((q) => { q.type = "gendental"; q.pmsName = "Something Else"; q.core.outbound.state = "new"; });
  p = await pushQuoteToApplication(db, CLIENT, pushQ2, "ryan@agentivory.com", NOW);
  const app2 = db.tables.applications[0];
  eq("pushing again updates the same application (no duplicate)", [p.ok && p.created, db.tables.applications.length, p.ok && p.applicationId], [false, 1, app.id]);
  eq("...and reports the status so the screen can say it changed a submitted one", p.ok && p.status, "submitted");
  eq("...products and price follow the new quote", [app2.selected_products, app2.upfront_total_aud], [["inbound", "outbound"], Math.round(computeQuote(pushQ2).setupTotal * 100) / 100]);
  eq("...everything typed on the application is left alone", [app2.goals, app2.requirements, app2.team_members, app2.services, app2.owner_name, app2.status, app2.discount_percent], ["More new patients", "Book into D4W", [{ name: "Dr Kim" }], [{ id: "s1", name: "Check-up" }], "Dr Kimberley Lee", "submitted", 10]);
  eq("...including a practice software name already typed", app2.booking_platform_name, "Typed By Hand");
  Object.assign(db.tables.applications[0], { booking_platform_name: "  " });
  await pushQuoteToApplication(db, CLIENT, pushQ2, null, NOW);
  eq("...but a blank one is filled from the quote", db.tables.applications[0].booking_platform_name, "Something Else");
  eq("the quote against the client is the latest one", [db.tables.client_quotes.length, db.tables.client_quotes[0].state.pmsName], [1, "Something Else"]);

  // the latest application is the one that gets updated
  db = makeDb({ ...seed(), applications: [{ id: "a-old", client_id: CLIENT, updated_at: "2026-10-01", status: "paid", booking_platform_name: "x" }, { id: "a-new", client_id: CLIENT, updated_at: "2026-10-20", status: "draft", booking_platform_name: "x" }] });
  p = await pushQuoteToApplication(db, CLIENT, quote(), null, NOW);
  eq("with several applications, the most recent one is updated", [p.ok && p.applicationId, db.tables.applications.find((a: Row) => a.id === "a-old").selected_products], ["a-new", undefined]);

  // refusals
  db = makeDb(seed());
  p = await pushQuoteToApplication(db, CLIENT, quote((q) => { q.core.inbound.state = "off"; }), null, NOW);
  eq("a quote with nothing to build isn't pushed, and isn't saved either", [!p.ok && /at least one product/.test(p.error), (db.tables.client_quotes ?? []).length, (db.tables.applications ?? []).length], [true, 0, 0]);
  p = await pushQuoteToApplication(db, "ghost", quote(), null, NOW);
  eq("an unknown client is refused", !p.ok && /no longer exists/.test(p.error), true);
  p = await pushQuoteToApplication(makeDb(seed(), { missing: ["client_quotes"] }), CLIENT, quote(), null, NOW);
  eq("before the migration: the plain-words setup message", !p.ok && /One setup step left/.test(p.error), true);
  p = await pushQuoteToApplication(db, CLIENT, "not even an object", null, NOW);
  eq("junk instead of a quote falls back to the default quote (inbound calls) rather than crashing", p.ok && p.products, 1);

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
