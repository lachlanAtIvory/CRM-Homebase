-- =============================================================
-- Lock the database to team access.
--
-- STEP 2 of 2. Run this only AFTER the app has been deployed and both
-- Ryan and Lachlan have opened the CRM once (that registers them as
-- managers). The first statement below refuses to run otherwise, so you
-- cannot lock yourselves out.
--
-- Until now every signed-in person could read and change every table
-- (policies "authenticated full access"), because the browser holds a
-- sign-in token that can talk to the database directly. Hiding a menu
-- item does not stop that. This replaces those blanket policies with ones
-- that check the person's sections (see public.has_any_section).
--
-- Managers pass every check. Public (anon) policies are left alone: the
-- hotel concierge's guest pages and the tracking script keep working.
-- The app's own server code uses the service role, which skips these
-- rules by design.
--
-- To undo: run supabase/rollbacks/20261018130000_unlock_database.sql
-- =============================================================

do $$
begin
  if (select count(*) from public.team_members where role = 'manager' and status = 'active') < 2 then
    raise exception
      'Stopped: fewer than 2 active managers are registered. Deploy the app and have both Ryan and Lachlan open the CRM once, check Settings > Team shows both, then run this again.';
  end if;
end $$;

-- Make sure row level security is switched on for every table we manage.
-- (Harmless if it already is; closes the table to the public key if it wasn't.)
alter table public.clients            enable row level security;
alter table public.deals              enable row level security;
alter table public.stage_history      enable row level security;
alter table public.meetings           enable row level security;
alter table public.tasks              enable row level security;
alter table public.applications       enable row level security;
alter table public.products           enable row level security;
alter table public.client_invoices    enable row level security;
alter table public.analytics_events   enable row level security;
alter table public.concierge_hotels   enable row level security;
alter table public.concierge_facts    enable row level security;
alter table public.concierge_local    enable row level security;
alter table public.concierge_sessions enable row level security;
alter table public.concierge_messages enable row level security;
alter table public.agents             enable row level security;
alter table public.agent_activity     enable row level security;
alter table public.hq_clients         enable row level security;
alter table public.calls              enable row level security;
alter table public.jobs               enable row level security;
alter table public.prospects          enable row level security;
alter table public.prospect_events    enable row level security;
alter table public.outreach_events    enable row level security;
alter table public.call_leads         enable row level security;
alter table public.call_lead_notes    enable row level security;

-- Remove the blanket "any signed-in person" policies.
drop policy if exists "auth full access"                          on public.clients;
drop policy if exists "auth full access"                          on public.deals;
drop policy if exists "auth full access"                          on public.stage_history;
drop policy if exists "auth full access"                          on public.meetings;
drop policy if exists "auth full access"                          on public.agents;
drop policy if exists "auth full access"                          on public.agent_activity;
drop policy if exists "auth full access"                          on public.hq_clients;
drop policy if exists "auth full access"                          on public.calls;
drop policy if exists "auth full access"                          on public.prospects;
drop policy if exists "auth full access"                          on public.prospect_events;
drop policy if exists "auth full access"                          on public.outreach_events;
drop policy if exists "auth full access"                          on public.jobs;
drop policy if exists "authenticated full access to tasks"        on public.tasks;
drop policy if exists "authenticated full access to products"     on public.products;
drop policy if exists "authenticated full access to applications" on public.applications;
drop policy if exists "authenticated read analytics"              on public.analytics_events;
drop policy if exists "auth full hotels"                          on public.concierge_hotels;
drop policy if exists "auth full facts"                           on public.concierge_facts;
drop policy if exists "auth full local"                           on public.concierge_local;
drop policy if exists "auth full sessions"                        on public.concierge_sessions;
drop policy if exists "auth full messages"                        on public.concierge_messages;
drop policy if exists "authenticated full access to client_invoices"  on public.client_invoices;
drop policy if exists "authenticated full access to call_leads"       on public.call_leads;
drop policy if exists "authenticated full access to call_lead_notes"  on public.call_lead_notes;

-- Safe to run twice: clear out any "team access" policies from an earlier run first.
do $$
declare
  t text;
begin
  foreach t in array array[
    'clients','deals','stage_history','meetings','agents','agent_activity','hq_clients','calls',
    'prospects','prospect_events','outreach_events','jobs','tasks','products','applications',
    'analytics_events','concierge_hotels','concierge_facts','concierge_local','concierge_sessions',
    'concierge_messages','client_invoices','call_leads','call_lead_notes'
  ] loop
    execute format('drop policy if exists "team access" on public.%I', t);
  end loop;
end $$;

-- Section-based replacements. The section keys match src/lib/hq/access.ts.
-- A table is open to every section whose pages genuinely read it.

create policy "team access" on public.clients for all to authenticated
  using ((select public.has_any_section(array['home','applications','clients','pipeline','tasks','finance'])))
  with check ((select public.has_any_section(array['home','applications','clients','pipeline','tasks','finance'])));

create policy "team access" on public.deals for all to authenticated
  using ((select public.has_any_section(array['home','applications','clients','pipeline'])))
  with check ((select public.has_any_section(array['home','applications','clients','pipeline'])));

create policy "team access" on public.stage_history for all to authenticated
  using ((select public.has_any_section(array['home','clients','pipeline'])))
  with check ((select public.has_any_section(array['home','clients','pipeline'])));

create policy "team access" on public.meetings for all to authenticated
  using ((select public.has_any_section(array['home','calendar'])))
  with check ((select public.has_any_section(array['home','calendar'])));

create policy "team access" on public.tasks for all to authenticated
  using ((select public.has_any_section(array['home','tasks','clients','pipeline'])))
  with check ((select public.has_any_section(array['home','tasks','clients','pipeline'])));

create policy "team access" on public.applications for all to authenticated
  using ((select public.has_any_section(array['applications','clients'])))
  with check ((select public.has_any_section(array['applications','clients'])));

create policy "team access" on public.products for all to authenticated
  using ((select public.has_any_section(array['applications'])))
  with check ((select public.has_any_section(array['applications'])));

create policy "team access" on public.client_invoices for all to authenticated
  using ((select public.has_any_section(array['finance'])))
  with check ((select public.has_any_section(array['finance'])));

create policy "team access" on public.analytics_events for select to authenticated
  using ((select public.has_any_section(array['analytics'])));

-- The concierge's public read policies ("anyone read hotels/facts/local") are untouched.
create policy "team access" on public.concierge_hotels for all to authenticated
  using ((select public.has_any_section(array['concierge'])))
  with check ((select public.has_any_section(array['concierge'])));
create policy "team access" on public.concierge_facts for all to authenticated
  using ((select public.has_any_section(array['concierge'])))
  with check ((select public.has_any_section(array['concierge'])));
create policy "team access" on public.concierge_local for all to authenticated
  using ((select public.has_any_section(array['concierge'])))
  with check ((select public.has_any_section(array['concierge'])));
create policy "team access" on public.concierge_sessions for all to authenticated
  using ((select public.has_any_section(array['concierge'])))
  with check ((select public.has_any_section(array['concierge'])));
create policy "team access" on public.concierge_messages for all to authenticated
  using ((select public.has_any_section(array['concierge'])))
  with check ((select public.has_any_section(array['concierge'])));

create policy "team access" on public.agents for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.agent_activity for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.hq_clients for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.calls for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.jobs for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.prospects for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));
create policy "team access" on public.outreach_events for all to authenticated
  using ((select public.has_any_section(array['agents'])))
  with check ((select public.has_any_section(array['agents'])));

-- Call activity is shared by the Motivation dashboard and the Call List.
create policy "team access" on public.prospect_events for all to authenticated
  using ((select public.has_any_section(array['motivation','call-list','agents'])))
  with check ((select public.has_any_section(array['motivation','call-list','agents'])));

create policy "team access" on public.call_leads for all to authenticated
  using ((select public.has_any_section(array['call-list'])))
  with check ((select public.has_any_section(array['call-list'])));
create policy "team access" on public.call_lead_notes for all to authenticated
  using ((select public.has_any_section(array['call-list'])))
  with check ((select public.has_any_section(array['call-list'])));

-- Tell the Team screen the lock is on.
create or replace function public.rls_hardened()
returns boolean
language sql stable
as $$ select true $$;
