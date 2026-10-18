-- =============================================================
-- UNDO for 20261018130000_lock_database_to_team_access.sql
--
-- Puts the database back to "any signed-in person can read and change
-- everything", exactly as it was before the lock. Run this in the Supabase
-- SQL editor if the lock ever causes a problem you can't fix quickly.
-- Not a migration: it lives in supabase/rollbacks so it never runs by itself.
-- =============================================================

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

create policy "auth full access" on public.clients         for all to authenticated using (true) with check (true);
create policy "auth full access" on public.deals           for all to authenticated using (true) with check (true);
create policy "auth full access" on public.stage_history   for all to authenticated using (true) with check (true);
create policy "auth full access" on public.meetings        for all to authenticated using (true) with check (true);
create policy "auth full access" on public.agents          for all to authenticated using (true) with check (true);
create policy "auth full access" on public.agent_activity  for all to authenticated using (true) with check (true);
create policy "auth full access" on public.hq_clients      for all to authenticated using (true) with check (true);
create policy "auth full access" on public.calls           for all to authenticated using (true) with check (true);
create policy "auth full access" on public.prospects       for all to authenticated using (true) with check (true);
create policy "auth full access" on public.prospect_events for all to authenticated using (true) with check (true);
create policy "auth full access" on public.outreach_events for all to authenticated using (true) with check (true);
create policy "auth full access" on public.jobs            for all to authenticated using (true) with check (true);
create policy "authenticated full access to tasks"        on public.tasks        for all to authenticated using (true) with check (true);
create policy "authenticated full access to products"     on public.products     for all to authenticated using (true) with check (true);
create policy "authenticated full access to applications" on public.applications for all to authenticated using (true) with check (true);
create policy "authenticated read analytics"              on public.analytics_events for select to authenticated using (true);
create policy "auth full hotels"   on public.concierge_hotels   for all to authenticated using (true) with check (true);
create policy "auth full facts"    on public.concierge_facts    for all to authenticated using (true) with check (true);
create policy "auth full local"    on public.concierge_local    for all to authenticated using (true) with check (true);
create policy "auth full sessions" on public.concierge_sessions for all to authenticated using (true) with check (true);
create policy "auth full messages" on public.concierge_messages for all to authenticated using (true) with check (true);
create policy "authenticated full access to client_invoices"  on public.client_invoices  for all to authenticated using (true) with check (true);
create policy "authenticated full access to call_leads"       on public.call_leads       for all to authenticated using (true) with check (true);
create policy "authenticated full access to call_lead_notes"  on public.call_lead_notes  for all to authenticated using (true) with check (true);

create or replace function public.rls_hardened()
returns boolean
language sql stable
as $$ select false $$;
