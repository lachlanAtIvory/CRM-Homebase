/**
 * Checks who-is-this resolution and the Settings > Team logic (add before first sign-in, change access, switch off, remove, guards) against an in-memory database.
 *
 * Run from the repo root:  npx tsx scripts/checks/team-admin.check.ts
 * Prints a pass/fail count; any FAIL line means an access rule changed.
 */
process.env.ALLOWED_EMAILS = "lachlan@agentivory.com, Ryan@agentivory.com";
import { resolveAccess, ensureFounderRecord, recordLogin } from "../../src/lib/hq/access-server";
import { addMember, updateMember, removeMember, loadTeam } from "../../src/lib/hq/team-admin";

type Row = Record<string, any>;
function makeDb(seed: Record<string, Row[]> = {}, opts: { missing?: string[]; failSelect?: string[]; hardened?: boolean | "error" } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const missingErr = { code: "42P01", message: 'relation "public.team_members" does not exist' };
  class Q {
    mode = "select"; payload: any; returning = false; f: ((r: Row) => boolean)[] = []; ord: [string, boolean][] = []; lim = Infinity; one: "single" | "maybe" | null = null;
    constructor(public t: string) {}
    select() { if (this.mode !== "select") this.returning = true; return this; }
    insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
    update(p: any) { this.mode = "update"; this.payload = p; return this; }
    delete() { this.mode = "delete"; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    order(c: string, o?: any) { this.ord.push([c, o?.ascending !== false]); return this; }
    limit(x: number) { this.lim = x; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
    run(): any {
      if (opts.missing?.includes(this.t)) return { data: null, error: missingErr };
      if (opts.failSelect?.includes(this.t) && this.mode === "select") return { data: null, error: { code: "XX000", message: "connection reset" } };
      const rows = (tables[this.t] ??= []);
      if (this.mode === "insert") {
        const row = { id: `${this.t}-${++n}`, created_at: new Date(2026, 9, 18, 10, n).toISOString(), ...this.payload };
        if (this.t === "team_members" && rows.some((r) => r.email === row.email)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.push(row);
        return this.finish([row]);
      }
      let hit = rows.filter((r) => this.f.every((g) => g(r)));
      if (this.mode === "update") { hit.forEach((r) => Object.assign(r, this.payload)); return this.finish(hit); }
      if (this.mode === "delete") { hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return { data: null, error: null }; }
      for (const [c, asc] of [...this.ord].reverse()) hit = [...hit].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      return this.finish(hit.slice(0, this.lim));
    }
    finish(rs: Row[]) {
      const out = rs.map((r) => ({ ...r }));
      if (this.one) return out.length ? { data: out[0], error: null } : this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out, error: null };
    }
  }
  return { tables, from: (t: string) => new Q(t), rpc: async (name: string) => (name === "rls_hardened" ? (opts.hardened === "error" ? { data: null, error: missingErr } : { data: opts.hardened === true, error: null }) : { data: null, error: { message: "unknown rpc" } }) } as any;
}

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { if (c) passes++; else { fails++; console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d)); } };
const L = "lachlan@agentivory.com";
const audits = (db: any) => db.tables.team_audit ?? [];

(async () => {
  // ── who is this?
  let db = makeDb({ team_members: [
    { id: "a", email: "jan@agentivory.com", name: "Jan", role: "member", sections: ["call-list"], status: "invited" },
    { id: "b", email: "sam@agentivory.com", name: "Sam", role: "member", sections: ["tasks", "bogus"], status: "active" },
    { id: "c", email: "old@agentivory.com", name: "Old", role: "member", sections: ["call-list"], status: "deactivated" },
  ] });
  let r: any = await resolveAccess(db, "Lachlan@Agentivory.com");
  ok("founder resolves from the allowed list with no database lookup (even if the table is down)", r.ok && r.access.role === "manager" && r.access.source === "env" && r.access.sections.length >= 15, r);
  r = await resolveAccess(makeDb({}, { failSelect: ["team_members"] }), "ryan@agentivory.com");
  ok("founders still get in when the database errors", r.ok && r.access.role === "manager");
  r = await resolveAccess(db, "JAN@agentivory.com");
  ok("invited member resolves (email case ignored)", r.ok && r.access.role === "member" && r.access.status === "invited" && r.access.name === "Jan" && JSON.stringify(r.access.sections) === '["call-list"]', r);
  r = await resolveAccess(db, "sam@agentivory.com");
  ok("unknown section keys in the row are ignored", r.ok && JSON.stringify(r.access.sections) === '["tasks"]', r);
  r = await resolveAccess(db, "old@agentivory.com");
  ok("deactivated is refused with a reason", !r.ok && r.reason === "deactivated", r);
  r = await resolveAccess(db, "stranger@gmail.com");
  ok("a stranger is refused", !r.ok && r.reason === "none", r);
  r = await resolveAccess(db, null);
  ok("no email is refused", !r.ok && r.reason === "none");
  r = await resolveAccess(makeDb({}, { missing: ["team_members"] }), "jan@agentivory.com");
  ok("before the migration is run, non-founders are simply refused (no crash)", !r.ok && r.reason === "none", r);
  r = await resolveAccess(makeDb({}, { failSelect: ["team_members"] }), "jan@agentivory.com");
  ok("a database error for a member is 'error', not 'none' (so they're not signed out over a blip)", !r.ok && r.reason === "error", r);

  // ── founder bookkeeping
  db = makeDb();
  const founderAccess = { email: L, name: null, role: "manager" as const, sections: [], status: "active" as const, source: "env" as const };
  await ensureFounderRecord(db, founderAccess);
  ok("founder gets a manager row on first visit", db.tables.team_members.length === 1 && db.tables.team_members[0].role === "manager" && db.tables.team_members[0].status === "active" && db.tables.team_members[0].name === "Lachlan");
  await ensureFounderRecord(db, founderAccess);
  ok("...and only one, however many visits", db.tables.team_members.length === 1);
  db.tables.team_members[0].status = "deactivated"; db.tables.team_members[0].role = "member";
  await ensureFounderRecord(db, founderAccess);
  ok("a founder row that somehow got downgraded is repaired", db.tables.team_members[0].role === "manager" && db.tables.team_members[0].status === "active");
  await ensureFounderRecord(makeDb({}, { missing: ["team_members"] }), founderAccess);
  ok("no crash before the migration", true);
  await ensureFounderRecord(db, { ...founderAccess, source: "team" });
  ok("non-env access is never auto-created", db.tables.team_members.length === 1);

  // ── adding Jan BEFORE he has signed in
  db = makeDb();
  let a: any = await addMember(db, L, { email: " Jan@Agentivory.com ", name: " Jan ", preset: "caller" });
  ok("add: ok, email lower-cased, name trimmed, invited, caller preset", a.ok && a.member.email === "jan@agentivory.com" && a.member.name === "Jan" && a.member.status === "invited" && JSON.stringify(a.member.sections) === '["call-list"]', a);
  ok("add: row stored with who invited", db.tables.team_members[0].invited_by === L && db.tables.team_members[0].role === "member");
  ok("add: audited", audits(db).length === 1 && audits(db)[0].action === "added member" && audits(db)[0].target_email === "jan@agentivory.com" && audits(db)[0].actor === L);
  a = await addMember(db, L, { email: "jan@agentivory.com" });
  ok("add: duplicate refused (409)", !a.ok && a.status === 409, a);
  a = await addMember(db, L, { email: "JAN@agentivory.com" });
  ok("add: duplicate refused regardless of case", !a.ok && a.status === 409);
  a = await addMember(db, L, { email: "ryan@agentivory.com" });
  ok("add: a founder can't be added as a member", !a.ok && a.status === 409 && /founders/.test(a.error), a);
  a = await addMember(db, L, { email: "RYAN@agentivory.com" });
  ok("add: founder check ignores case", !a.ok && a.status === 409);
  for (const bad of ["", "nope", "a@b", 5, null, undefined, "x y@z.com"]) { a = await addMember(db, L, { email: bad as any }); ok(`add: rejects ${JSON.stringify(bad)}`, !a.ok && a.status === 400, a); }
  a = await addMember(db, L, { email: "sections@agentivory.com", sections: ["pipeline", "bogus", "finance"] });
  ok("add: explicit sections win and are sanitised", a.ok && JSON.stringify(a.member.sections) === '["pipeline","finance"]', a);
  a = await addMember(db, L, { email: "none@agentivory.com", preset: "none" });
  ok("add: 'Nothing yet' preset gives zero access", a.ok && a.member.sections.length === 0);
  a = await addMember(db, L, { email: "unknownpreset@agentivory.com", preset: "whatever" });
  ok("add: an unknown preset falls back to the safe cold-caller default (never more access)", a.ok && JSON.stringify(a.member.sections) === '["call-list"]', a);
  a = await addMember(makeDb({}, { missing: ["team_members"] }), L, { email: "x@agentivory.com" });
  ok("add: before the migration -> 503 with a plain message", !a.ok && a.status === 503, a);
  a = await addMember(db, L, { email: "long@agentivory.com", name: "x".repeat(500) });
  ok("add: name is length-limited", a.ok && a.member.name.length === 80);

  // ── changing access
  const jan = db.tables.team_members.find((m: Row) => m.email === "jan@agentivory.com");
  let u: any = await updateMember(db, L, jan.id, { sections: ["call-list", "motivation", "nonsense"] });
  ok("update: sections saved, sanitised", u.ok && JSON.stringify(u.member.sections) === '["call-list","motivation"]', u);
  const au = audits(db).at(-1);
  ok("update: audit says what was turned on", au.action === "changed access" && JSON.stringify(au.detail.added) === '["motivation"]' && JSON.stringify(au.detail.removed) === "[]", au);
  u = await updateMember(db, L, jan.id, { sections: ["motivation"] });
  ok("update: audit says what was turned off", JSON.stringify(audits(db).at(-1).detail) === '{"added":[],"removed":["call-list"]}', audits(db).at(-1));
  u = await updateMember(db, L, jan.id, { sections: [] });
  ok("update: everything can be turned off", u.ok && u.member.sections.length === 0);
  const before = audits(db).length;
  u = await updateMember(db, L, jan.id, {});
  ok("update: an empty change does nothing and logs nothing", u.ok && audits(db).length === before);
  u = await updateMember(db, L, jan.id, { name: "  Jan K  " });
  ok("update: rename", u.ok && u.member.name === "Jan K");

  // ── switching off / on
  u = await updateMember(db, L, jan.id, { status: "deactivated" });
  ok("switch off: status flips", u.ok && u.member.status === "deactivated" && audits(db).at(-1).action === "deactivated", u);
  u = await updateMember(db, L, jan.id, { status: "active" });
  ok("switch back on: never signed in -> goes back to 'invited', not 'active'", u.ok && u.member.status === "invited", u);
  db.tables.team_members.find((m: Row) => m.id === jan.id).first_login_at = "2026-10-19T00:00:00Z";
  await updateMember(db, L, jan.id, { status: "deactivated" });
  u = await updateMember(db, L, jan.id, { status: "active" });
  ok("switch back on: has signed in before -> 'active'", u.ok && u.member.status === "active", u);
  u = await updateMember(db, L, jan.id, { status: "super-admin" });
  ok("update: unknown status refused", !u.ok && u.status === 400, u);

  // ── what can NOT be touched
  db.tables.team_members.push({ id: "mgr1", email: "boss@agentivory.com", role: "manager", sections: [], status: "active" });
  db.tables.team_members.push({ id: "fnd", email: "ryan@agentivory.com", role: "member", sections: [], status: "active", name: "Ryan" });
  u = await updateMember(db, L, "mgr1", { status: "deactivated" });
  ok("a manager row can't be edited here", !u.ok && u.status === 403, u);
  u = await updateMember(db, L, "fnd", { sections: ["call-list"] });
  ok("a founder can't be edited even if their row looks like a member", !u.ok && u.status === 403, u);
  u = await updateMember(db, L, "does-not-exist", { sections: [] });
  ok("missing person -> 404", !u.ok && u.status === 404, u);
  let d: any = await removeMember(db, L, "mgr1");
  ok("a manager row can't be removed here", !d.ok && d.status === 403);
  d = await removeMember(db, L, "fnd");
  ok("a founder can't be removed", !d.ok && d.status === 403);
  d = await removeMember(db, L, jan.id);
  ok("remove: works, row gone, audited", d.ok && !db.tables.team_members.some((m: Row) => m.id === jan.id) && audits(db).at(-1).action === "removed member");
  d = await removeMember(db, L, jan.id);
  ok("remove twice -> 404", !d.ok && d.status === 404);
  a = await addMember(db, L, { email: "jan@agentivory.com" });
  ok("a removed email can be added again fresh", a.ok && a.member.status === "invited");

  // ── the overview the screen shows
  db = makeDb({ team_members: [
    { id: "1", email: L, name: "Lachlan", role: "manager", sections: [], status: "active", last_login_at: "2026-10-18T00:00:00Z", created_at: "2026-10-18T00:00:00Z" },
    { id: "2", email: "jan@agentivory.com", name: "Jan", role: "member", sections: ["call-list"], status: "invited", created_at: "2026-10-18T01:00:00Z" },
    { id: "3", email: "boss@agentivory.com", name: "Boss", role: "manager", sections: [], status: "active", created_at: "2026-10-18T02:00:00Z" },
  ], team_audit: [{ id: "x", actor: L, action: "added member", target_email: "jan@agentivory.com", detail: {}, at: "2026-10-18T01:00:00Z" }] }, { hardened: true });
  let t: any = await loadTeam(db);
  ok("overview: both founders listed, even the one with no row yet", t.founders.map((f: any) => f.email).join() === "lachlan@agentivory.com,ryan@agentivory.com" && t.founders[0].last_login_at && t.founders[1].last_login_at === null && t.founders[1].name === "Ryan", t.founders);
  ok("overview: members only (managers and founders excluded)", t.members.length === 1 && t.members[0].email === "jan@agentivory.com", t.members);
  ok("overview: lock status + audit + not-setup", t.hardened === true && t.audit.length === 1 && t.setupNeeded === false);
  t = await loadTeam(makeDb({}, { hardened: false }));
  ok("overview: lock not yet on", t.hardened === false);
  t = await loadTeam(makeDb({}, { hardened: "error" }));
  ok("overview: unknown lock state when the function is missing", t.hardened === null);
  t = await loadTeam(makeDb({}, { missing: ["team_members"] }));
  ok("overview: before the migration it says setup is needed and still lists the founders", t.setupNeeded === true && t.founders.length === 2 && t.members.length === 0, t);

  // ── sign-in bookkeeping
  db = makeDb({ team_members: [
    { id: "a", email: "jan@agentivory.com", role: "member", sections: ["call-list"], status: "invited", first_login_at: null },
    { id: "c", email: "old@agentivory.com", role: "member", sections: [], status: "deactivated", first_login_at: null },
  ] });
  await recordLogin(db, "Jan@Agentivory.com");
  const j = db.tables.team_members[0];
  ok("first sign-in: invited -> active, times stamped", j.status === "active" && !!j.first_login_at && !!j.last_login_at, j);
  const first = j.first_login_at;
  await recordLogin(db, "jan@agentivory.com");
  ok("later sign-ins keep the original first-login time", db.tables.team_members[0].first_login_at === first);
  await recordLogin(db, "old@agentivory.com");
  ok("a switched-off person's row is NOT reactivated by trying to sign in", db.tables.team_members[1].status === "deactivated" && !db.tables.team_members[1].first_login_at);
  await recordLogin(db, "nobody@x.com");
  ok("an unknown email creates nothing", db.tables.team_members.length === 2);

  console.log(`\n${passes} passed, ${fails} failed`);
})();
