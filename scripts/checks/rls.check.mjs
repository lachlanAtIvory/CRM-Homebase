/**
 * Checks the database lock in a REAL Postgres (PGlite, run in-process): loads every
 * migration, applies the two team-access migrations, then acts as a manager, Jan
 * (Call List only), a member with other sections, a switched-off member, a stranger
 * and an anonymous visitor, and checks exactly what each can read and write. Also
 * checks the "fewer than 2 managers" guard, instant switch-off, the rollback, and
 * that running the lock twice is harmless.
 *
 * Run from the repo root (PGlite is installed temporarily, not added to the project):
 *   npm i --no-save @electric-sql/pglite && node scripts/checks/rls.check.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");


// Stand-ins for what Supabase provides: roles, the auth schema, storage buckets, default grants.
async function freshDb({ upTo = "99999999999999", only } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('create extension if not exists pgcrypto');
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create publication supabase_realtime;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
  `);
  const files = readdirSync(`${REPO}/supabase/migrations`).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  for (const f of files) {
    const stamp = f.slice(0, 14);
    if (stamp > upTo) continue;
    if (only && !only(f)) continue;
    try { await db.exec(readFileSync(`${REPO}/supabase/migrations/${f}`, "utf8")); applied.push(f); }
    catch (e) { throw new Error(`MIGRATION FAILED: ${f} :: ${String(e.message).split("\n")[0]}`); }
  }
  return { db, applied };
}

/** Run a query as a given signed-in person (or anon / service role). */
async function as(db, who, sql, params) {
  if (who === "service") { await db.exec("reset role"); return db.query(sql, params); }
  if (who === "anon") { await db.exec("reset role; set role anon; select set_config('request.jwt.claims','',false)"); return db.query(sql, params); }
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ email: who, role: "authenticated" })}', false)`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}

const sql = (f) => readFileSync(`${REPO}/supabase/${f}`, "utf8");

let fails = 0, passes = 0;
const ok = (name, cond, detail) => { if (cond) passes++; else { fails++; console.log("FAIL:", name, detail === undefined ? "" : JSON.stringify(detail)); } };
const count = async (who, table) => { try { return (await as(db, who, `select count(*)::int n from public.${table}`)).rows[0].n; } catch (e) { return `ERR ${String(e.message).slice(0, 60)}`; } };
const tryWrite = async (who, q) => { try { const r = await as(db, who, q); return r.affectedRows ?? r.rows.length; } catch (e) { return `ERR ${String(e.message).slice(0, 80)}`; } };

const L = "lachlan@agentivory.com", R = "ryan@agentivory.com", JAN = "jan@agentivory.com", SAM = "sam@agentivory.com", OLD = "old@agentivory.com", STR = "stranger@gmail.com";

let db;
try {
  ({ db } = await freshDb({ upTo: "20261013150000" }));

  // ── Before anything: the hole we're closing
  await db.exec(`insert into public.clients (id, company_name) values ('00000000-0000-0000-0000-0000000000c1', 'Neutral Bay Dental')`);
  await db.exec(`insert into public.client_invoices (client_id, invoice_number, kind, issued_on, amount_aud, status, paid_on, file_path, file_name) values ('00000000-0000-0000-0000-0000000000c1','IVORY-1','setup','2026-09-15',1799,'paid','2026-09-23','c1/a.pdf','a.pdf')`);
  ok("BEFORE: any signed-in stranger can read invoices (the hole)", (await count(STR, "client_invoices")) === 1);

  // ── Step 1 migration
  await db.exec(sql("migrations/20261018120000_add_team_access.sql"));
  ok("step 1 applies", true);
  ok("rls_hardened() is false after step 1", (await db.query("select public.rls_hardened() v")).rows[0].v === false);
  ok("step 1 changes nothing yet: stranger still reads invoices", (await count(STR, "client_invoices")) === 1);

  // ── Team table constraints
  const ins = (e, role = "member", secs = "{}", status = "invited") => db.query(`insert into public.team_members (email, name, role, sections, status) values ($1, $2, $3, $4, $5)`, [e, e.split("@")[0], role, secs, status]);
  let bad = null; try { await ins("Jan@Agentivory.com"); } catch (e) { bad = e.message; }
  ok("upper-case email is rejected (emails are stored lower-case)", !!bad, bad);
  bad = null; try { await ins("not-an-email"); } catch (e) { bad = e.message; }
  ok("non-email rejected", !!bad);
  await ins(L, "manager", "{}", "active");

  // ── GUARD: step 2 must refuse with fewer than 2 active managers
  let guard = null; try { await db.exec(sql("migrations/20261018130000_lock_database_to_team_access.sql")); } catch (e) { guard = e.message; }
  ok("GUARD: step 2 refuses with only 1 manager registered", !!guard && /fewer than 2 active managers/.test(guard), guard);
  ok("GUARD: and changed nothing (stranger still reads invoices)", (await count(STR, "client_invoices")) === 1);

  // ── Register everyone
  await ins(R, "manager", "{}", "active");
  await ins(JAN, "member", "{call-list}", "invited");           // Jan: only the call list; hasn't signed in yet
  await ins(SAM, "member", "{tasks,clients}", "active");
  await ins(OLD, "member", "{call-list,clients}", "deactivated");

  // ── Seed one row in every managed table (service role)
  await db.exec(`
    insert into public.deals (client_id, current_stage) values ('00000000-0000-0000-0000-0000000000c1', 'live_client');
    insert into public.meetings (event_id, title, start_time, end_time) values ('e1','Sales call', now(), now() + interval '30 minutes');
    insert into public.tasks (client_id, title) values ('00000000-0000-0000-0000-0000000000c1', 'Call back');
    insert into public.applications (client_id) select id from public.clients limit 1;
    insert into public.hq_clients (name) values ('Physio K');
    insert into public.call_leads (lead_key, business_name) values ('k1', 'Breeze Dental');
    insert into public.call_lead_notes (lead_id, outcome, body) select id, 'note', 'x' from public.call_leads limit 1;
    insert into public.prospect_events (type, actor, detail) values ('cold_call', 'caller', '{}');
    insert into public.agents (name) values ('a') on conflict do nothing;
  `.replace("insert into public.agents (name) values ('a') on conflict do nothing;", "").replace("insert into public.applications (client_id) select id from public.clients limit 1;", ""));
  await db.exec(`insert into public.concierge_hotels (slug, name) values ('ivory-suites','Ivory Suites')`).catch(() => {});

  // ── Apply the lock
  await db.exec(sql("migrations/20261018130000_lock_database_to_team_access.sql"));
  ok("step 2 applies once both founders are registered", true);
  ok("rls_hardened() is true after step 2", (await db.query("select public.rls_hardened() v")).rows[0].v === true);

  // ── The matrix: who can read what
  const tables = ["clients", "deals", "client_invoices", "meetings", "tasks", "hq_clients", "call_leads", "call_lead_notes", "prospect_events"];
  const seen = async (who) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(who, t)])));

  const lachlan = await seen(L);
  ok("MANAGER reads every table", tables.every((t) => lachlan[t] >= 1), lachlan);
  const ryan = await seen(R);
  ok("2nd MANAGER reads every table", tables.every((t) => ryan[t] >= 1), ryan);

  const jan = await seen(JAN);
  ok("JAN (call-list only) sees the call list, its notes, and call activity", jan.call_leads === 1 && jan.call_lead_notes === 1 && jan.prospect_events === 1, jan);
  ok("JAN sees NO clients, deals, invoices, meetings, tasks, hq_clients", jan.clients === 0 && jan.deals === 0 && jan.client_invoices === 0 && jan.meetings === 0 && jan.tasks === 0 && jan.hq_clients === 0, jan);

  const sam = await seen(SAM);
  ok("SAM (tasks + clients) sees clients, deals, tasks", sam.clients === 1 && sam.deals === 1 && sam.tasks === 1, sam);
  ok("SAM does NOT see invoices (finance), meetings, call list, hq_clients, call activity", sam.client_invoices === 0 && sam.meetings === 0 && sam.call_leads === 0 && sam.hq_clients === 0 && sam.prospect_events === 0, sam);

  const old = await seen(OLD);
  ok("DEACTIVATED member sees nothing at all, even sections they had", Object.values(old).every((n) => n === 0), old);
  const str = await seen(STR);
  ok("STRANGER (signed in, not on the team) sees nothing", Object.values(str).every((n) => n === 0), str);
  const anon = await seen("anon");
  ok("ANON sees none of these tables", Object.values(anon).every((n) => n === 0 || String(n).startsWith("ERR")), anon);

  // ── Writes
  ok("JAN can write call notes", (await tryWrite(JAN, `insert into public.call_lead_notes (lead_id, outcome, body) select id, 'note', 'hi' from public.call_leads limit 1`)) === 1);
  ok("JAN can update a lead", (await tryWrite(JAN, `update public.call_leads set attempts = 1`)) === 1);
  ok("JAN can log call activity", (await tryWrite(JAN, `insert into public.prospect_events (type, actor, detail) values ('cold_call','caller','{}')`)) === 1);
  const janClient = await tryWrite(JAN, `insert into public.clients (company_name) values ('sneaky')`);
  ok("JAN cannot create a client", typeof janClient === "string" && /row-level security/.test(janClient), janClient);
  ok("JAN cannot edit invoices (0 rows touched)", (await tryWrite(JAN, `update public.client_invoices set status = 'outstanding'`)) === 0);
  ok("JAN cannot delete clients (0 rows touched)", (await tryWrite(JAN, `delete from public.clients`)) === 0);
  ok("...and the client and invoice are all still there", (await count("service", "clients")) === 1 && (await count("service", "client_invoices")) === 1);
  ok("MANAGER can still write everywhere", (await tryWrite(L, `insert into public.clients (company_name) values ('New Client')`)) === 1 && (await tryWrite(L, `update public.client_invoices set status = 'paid'`)) === 1);
  ok("SAM can edit tasks", (await tryWrite(SAM, `update public.tasks set title = 'x'`)) === 1);
  const samInv = await tryWrite(SAM, `insert into public.client_invoices (client_id, invoice_number, kind, issued_on, amount_aud, file_path, file_name) values ('00000000-0000-0000-0000-0000000000c1','X','other','2026-10-01',1,'c1/x.pdf','x.pdf')`);
  ok("SAM cannot create an invoice", typeof samInv === "string" && /row-level security/.test(samInv), samInv);

  // ── The team table itself
  const janSeesTeam = (await as(db, JAN, `select email from public.team_members order by email`)).rows.map((r) => r.email);
  ok("JAN can read ONLY his own team row", JSON.stringify(janSeesTeam) === JSON.stringify([JAN]), janSeesTeam);
  ok("MANAGER reads the whole team", (await count(L, "team_members")) === 5);
  ok("STRANGER reads no team rows", (await count(STR, "team_members")) === 0);
  const janPromote = await tryWrite(JAN, `update public.team_members set role = 'manager', sections = '{call-list,clients,finance}' where email = '${JAN}'`);
  ok("JAN CANNOT promote himself or grant himself sections (0 rows)", janPromote === 0, janPromote);
  ok("...his access is unchanged", (await db.query(`select role, sections from public.team_members where email='${JAN}'`)).rows[0].role === "member");
  ok("even a MANAGER session cannot write the team table directly (only the app's server can)", (await tryWrite(L, `update public.team_members set name = 'x'`)) === 0);
  ok("JAN cannot read the audit log", (await count(JAN, "team_audit")) === 0);
  await db.exec(`insert into public.team_audit (actor, action) values ('${L}', 'added member')`);
  ok("MANAGER can read the audit log", (await count(L, "team_audit")) === 1);

  // ── Public things that must keep working
  ok("ANON can still read concierge hotels (guest chat)", (await count("anon", "concierge_hotels")) >= 0 && !String(await count("anon", "concierge_hotels")).startsWith("ERR"));
  ok("service role (the app's server) sees everything, unaffected", (await count("service", "clients")) >= 1 && (await count("service", "team_members")) === 5);

  // ── Instant deactivation: flip Sam, he loses access on the next query
  await db.exec(`update public.team_members set status = 'deactivated' where email = '${SAM}'`);
  ok("DEACTIVATING Sam cuts him off immediately", (await count(SAM, "clients")) === 0 && (await count(SAM, "tasks")) === 0);
  await db.exec(`update public.team_members set status = 'active' where email = '${SAM}'`);
  ok("...and reactivating restores it", (await count(SAM, "clients")) >= 1);
  // Changing Jan's toggles takes effect on the next query
  await db.exec(`update public.team_members set sections = '{call-list,clients}' where email = '${JAN}'`);
  ok("GRANTING Jan 'clients' opens clients (and not invoices)", (await count(JAN, "clients")) >= 1 && (await count(JAN, "client_invoices")) === 0);
  await db.exec(`update public.team_members set sections = '{call-list}' where email = '${JAN}'`);
  ok("REVOKING it closes them again", (await count(JAN, "clients")) === 0);
  // Email case: tokens may carry mixed case
  const mixed = (await as(db, "Jan@Agentivory.com", `select count(*)::int n from public.call_leads`)).rows[0].n;
  ok("a mixed-case email in the sign-in token still matches", mixed === 1, mixed);

  // ── Rollback
  await db.exec(sql("rollbacks/20261018130000_unlock_database.sql"));
  ok("ROLLBACK applies", true);
  ok("rls_hardened() is false again", (await db.query("select public.rls_hardened() v")).rows[0].v === false);
  ok("after rollback the old behaviour is back (stranger reads invoices)", (await count(STR, "client_invoices")) === 1);
  // ...and the lock can be re-applied afterwards
  await db.exec(sql("migrations/20261018130000_lock_database_to_team_access.sql"));
  ok("lock re-applies cleanly after a rollback", (await count(STR, "client_invoices")) === 0 && (await count(L, "client_invoices")) === 1);
  // ...and running the lock twice in a row is harmless
  await db.exec(sql("migrations/20261018130000_lock_database_to_team_access.sql"));
  ok("running the lock twice is harmless", (await count(L, "client_invoices")) === 1 && (await count(JAN, "client_invoices")) === 0);
} catch (e) { fails++; console.log("ERROR:", String(e.message).slice(0, 400)); }
console.log(`\n${passes} passed, ${fails} failed`);
