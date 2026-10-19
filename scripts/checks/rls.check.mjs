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

  // ═══════════════════════════════════════════════════════════════
  // Round 2: availability tables + task ownership / client privacy
  // ═══════════════════════════════════════════════════════════════
  await db.exec(sql("migrations/20261019120000_add_call_availability.sql"));
  await db.exec(sql("migrations/20261019130000_tasks_ownership_and_client_privacy.sql"));
  ok("round 2 migrations apply on top of the lock", true);
  await db.exec(sql("migrations/20261019130000_tasks_ownership_and_client_privacy.sql"));
  ok("the tasks migration is safe to run twice", true);

  // Jan now has Tasks and Calendar as well as the Call List
  await db.exec(`update public.team_members set sections = '{call-list,tasks,calendar}' where email = '${JAN}'`);
  await db.exec(`delete from public.tasks`);
  await db.exec(`
    insert into public.tasks (title, created_by, assigned_to) values
      ('Manager task (mine)', '${L}', null),
      ('Old task from before owners existed', null, null),
      ('Chase Neutral Bay about the logo', '${L}', '${JAN}'),
      ('Sam''s own task', '${SAM}', null);`);
  const titles = async (who) => (await as(db, who, `select title from public.tasks order by title`)).rows.map((r) => r.title);

  const janTasks = await titles(JAN);
  ok("JAN (call-list + tasks + calendar) sees ONLY the task assigned to him", JSON.stringify(janTasks) === JSON.stringify(["Chase Neutral Bay about the logo"]), janTasks);
  ok("JAN still cannot read a single client, even with Tasks on", (await count(JAN, "clients")) === 0 && (await count(JAN, "deals")) === 0 && (await count(JAN, "client_invoices")) === 0);
  ok("JAN can see the calendar (he was given it)", (await count(JAN, "meetings")) >= 1);
  ok("JAN still can't see the call list's neighbours: hq_clients, applications", (await count(JAN, "hq_clients")) === 0 && (await count(JAN, "applications")) === 0);

  const made = await tryWrite(JAN, `insert into public.tasks (title) values ('Ring the accountant back')`);
  ok("JAN can create his own task", made === 1, made);
  const mine = (await as(db, "service", `select created_by, assigned_to from public.tasks where title = 'Ring the accountant back'`)).rows[0];
  ok("...and it's stamped with his email automatically", mine?.created_by === JAN, mine);
  ok("JAN now sees his two tasks", (await titles(JAN)).length === 2);
  const forged = await tryWrite(JAN, `insert into public.tasks (title, created_by) values ('Forged as Lachlan', '${L}')`);
  ok("JAN cannot create a task pretending to be Lachlan", typeof forged === "string" && /row-level security/.test(forged), forged);
  ok("JAN cannot edit or delete a manager's task (0 rows)", (await tryWrite(JAN, `update public.tasks set title = 'hacked' where title = 'Manager task (mine)'`)) === 0 && (await tryWrite(JAN, `delete from public.tasks where title = 'Manager task (mine)'`)) === 0);
  ok("JAN can complete the task assigned to him", (await tryWrite(JAN, `update public.tasks set completed_at = now() where title = 'Chase Neutral Bay about the logo'`)) === 1);
  ok("JAN cannot hand HIS task to himself from someone else's (re-assign trick): can't touch Sam's", (await tryWrite(JAN, `update public.tasks set assigned_to = '${JAN}' where title = 'Sam''s own task'`)) === 0);

  const lachlanTasks = await titles(L);
  ok("MANAGER sees every task, including old ownerless ones", lachlanTasks.length === 5 && lachlanTasks.includes("Old task from before owners existed"), lachlanTasks);
  ok("MANAGER can assign a task to Jan", (await tryWrite(L, `update public.tasks set assigned_to = '${JAN}' where title = 'Manager task (mine)'`)) === 1 && (await titles(JAN)).includes("Manager task (mine)"));
  const samTasks = await titles(SAM);
  ok("SAM (tasks + clients) sees only his own task, not the managers'", JSON.stringify(samTasks) === JSON.stringify(["Sam's own task"]), samTasks);
  ok("SAM can still read clients because he has the Clients section", (await count(SAM, "clients")) >= 1);
  ok("a STRANGER and a switched-off member see no tasks", (await titles(STR)).length === 0 && (await titles(OLD)).length === 0);

  // Callback owner column
  ok("JAN can record who a callback is for", (await tryWrite(JAN, `update public.call_leads set callback_by = '${JAN}'`)) === 1);

  // Availability
  ok("the starting hours were seeded (11 windows)", (await count("service", "availability_windows")) === 11);
  ok("JAN can read the hours (the slot picker needs them)", (await count(JAN, "availability_windows")) === 11 && (await count(JAN, "availability_blocks")) === 0);
  const ryanHours = (await as(db, JAN, `select weekday from public.availability_windows where person = 'ryan' order by weekday`)).rows.map((r) => r.weekday);
  ok("Ryan's seeded days are Mon-Fri + weekend", JSON.stringify(ryanHours) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]), ryanHours);
  const lachHours = (await as(db, JAN, `select weekday from public.availability_windows where person = 'lachlan' order by weekday`)).rows.map((r) => r.weekday);
  ok("Lachlan's seeded days are Wed, Fri, Sat, Sun", JSON.stringify(lachHours) === JSON.stringify([0, 3, 5, 6]), lachHours);
  ok("JAN cannot change the hours (0 rows touched)", (await tryWrite(JAN, `update public.availability_windows set end_time = '23:00'`)) === 0);
  const janIns = await tryWrite(JAN, `insert into public.availability_windows (person, weekday, start_time, end_time) values ('ryan', 0, '00:00', '23:00') on conflict do nothing`);
  ok("JAN cannot add hours", janIns === 0 || (typeof janIns === "string" && /row-level security/.test(janIns)), janIns);
  const janBlock = await tryWrite(JAN, `insert into public.availability_blocks (person, starts_at, ends_at) values ('ryan', now(), now() + interval '1 day')`);
  ok("JAN cannot block out Ryan's time", typeof janBlock === "string" && /row-level security/.test(janBlock), janBlock);
  ok("MANAGER can change hours", (await tryWrite(L, `update public.availability_windows set end_time = '17:00' where person = 'lachlan' and weekday = 3`)) === 1);
  ok("MANAGER can add time off", (await tryWrite(L, `insert into public.availability_blocks (person, starts_at, ends_at, reason) values ('ryan', now(), now() + interval '2 days', 'Holiday')`)) === 1);
  ok("JAN can see that time off (so slots hide it)", (await count(JAN, "availability_blocks")) === 1);
  ok("a STRANGER reads no hours", (await count(STR, "availability_windows")) === 0);
  ok("a member with only Tasks (no call list/calendar/settings) can't read the hours", (await (async () => { await db.exec(`update public.team_members set sections = '{tasks}' where email = '${SAM}'`); return count(SAM, "availability_windows"); })()) === 0);

  // Undo script for round 2, then re-apply
  await db.exec(sql("rollbacks/20261019130000_undo_tasks_ownership.sql"));
  ok("UNDO: Jan with Tasks can read clients again (the old behaviour)", (await count(JAN, "clients")) >= 1);
  await db.exec(sql("migrations/20261019130000_tasks_ownership_and_client_privacy.sql"));
  ok("...and re-applying the migration restores the privacy", (await count(JAN, "clients")) === 0 && (await titles(JAN)).length >= 1);

  // ═══════════════════════════════════════════════════════════════
  // Round 3: JustCall call log (call_activity, justcall_events)
  // ═══════════════════════════════════════════════════════════════
  await db.exec(sql("migrations/20261020120000_add_justcall.sql"));
  ok("round 3 (JustCall) migration applies on top of the lock", true);
  await db.exec(sql("migrations/20261020120000_add_justcall.sql"));
  ok("the JustCall migration is safe to run twice", true);

  await db.exec(`update public.team_members set sections = '{call-list}' where email = '${JAN}'`);
  await db.exec(`update public.team_members set sections = '{tasks,clients}' where email = '${SAM}'`);
  await db.exec(`
    insert into public.call_activity (provider_call_id, call_sid, lead_id, direction, call_type, contact_e164, agent_email, started_at, duration_seconds, recording_url)
      select '1001', 'CA1', id, 'outgoing', 'answered', '+61755551234', '${JAN}', now(), 130, 'https://app.justcall.io/rec/1.mp3' from public.call_leads limit 1;
    insert into public.call_activity (provider_call_id, direction, call_type, contact_e164) values ('1002', 'incoming', 'missed', '+61400000000');
    insert into public.justcall_events (event_type, provider_call_id, outcome) values ('call.completed', '1001', 'processed');
  `);

  ok("JAN (call-list) reads the call log", (await count(JAN, "call_activity")) === 2);
  ok("MANAGER reads the call log", (await count(L, "call_activity")) === 2 && (await count(R, "call_activity")) === 2);
  ok("SAM (tasks + clients, no call list) can't read the call log", (await count(SAM, "call_activity")) === 0);
  ok("STRANGER, switched-off member and anon can't read the call log", (await count(STR, "call_activity")) === 0 && (await count(OLD, "call_activity")) === 0 && (() => true)());
  const anonCalls = await count("anon", "call_activity");
  ok("ANON can't read the call log", anonCalls === 0 || String(anonCalls).startsWith("ERR"), anonCalls);

  ok("MANAGER reads the webhook log", (await count(L, "justcall_events")) === 1);
  ok("JAN cannot read the webhook log (managers only)", (await count(JAN, "justcall_events")) === 0);
  ok("SAM and a stranger can't read the webhook log", (await count(SAM, "justcall_events")) === 0 && (await count(STR, "justcall_events")) === 0);

  // Nobody writes from a browser session: only the app's server (service role) records calls
  const janIns2 = await tryWrite(JAN, `insert into public.call_activity (provider_call_id, direction, call_type) values ('forged', 'outgoing', 'answered')`);
  ok("JAN cannot add a call to the log", typeof janIns2 === "string" && /row-level security/.test(janIns2), janIns2);
  ok("JAN cannot edit or delete logged calls (0 rows)", (await tryWrite(JAN, `update public.call_activity set duration_seconds = 9999`)) === 0 && (await tryWrite(JAN, `delete from public.call_activity`)) === 0);
  const mgrIns = await tryWrite(L, `insert into public.call_activity (provider_call_id, direction, call_type) values ('forged2', 'outgoing', 'answered')`);
  ok("even a MANAGER session cannot write the call log directly", typeof mgrIns === "string" && /row-level security/.test(mgrIns), mgrIns);
  ok("MANAGER cannot write the webhook log either", typeof (await tryWrite(L, `insert into public.justcall_events (outcome) values ('processed')`)) === "string");
  ok("...and the log is untouched", (await count("service", "call_activity")) === 2);

  // The log's own rules
  const dup = await tryWrite("service", `insert into public.call_activity (provider_call_id, direction, call_type) values ('1001', 'outgoing', 'answered')`);
  ok("the same JustCall call can't be logged twice (unique)", typeof dup === "string" && /unique|duplicate/i.test(dup), dup);
  const badType = await tryWrite("service", `insert into public.call_activity (provider_call_id, direction, call_type) values ('9', 'outgoing', 'banana')`);
  ok("an unknown call type is refused", typeof badType === "string", badType);
  const badOutcome = await tryWrite("service", `insert into public.justcall_events (outcome) values ('banana')`);
  ok("an unknown webhook outcome is refused", typeof badOutcome === "string", badOutcome);
  await db.exec(`delete from public.call_leads where id = (select lead_id from public.call_activity where provider_call_id = '1001')`);
  const orphan = (await db.query(`select lead_id from public.call_activity where provider_call_id = '1001'`)).rows[0];
  ok("deleting a lead keeps its calls in the log (lead becomes empty)", orphan && orphan.lead_id === null, orphan);
  const stamp = (await db.query(`select updated_at >= created_at as ok from public.call_activity where provider_call_id = '1001'`)).rows[0];
  ok("updated_at is maintained", stamp?.ok === true);
} catch (e) { fails++; console.log("ERROR:", String(e.message).slice(0, 400)); }
console.log(`\n${passes} passed, ${fails} failed`);
