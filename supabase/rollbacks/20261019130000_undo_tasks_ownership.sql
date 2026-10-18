-- =============================================================
-- UNDO for 20261019130000_tasks_ownership_and_client_privacy.sql
--
-- Puts the clients and tasks rules back to how the database lock set them:
-- anyone with the Tasks section can read clients, and sees every task.
-- The new columns are left in place (they're harmless); drop them yourself
-- if you really want them gone.
-- Not a migration: it lives in supabase/rollbacks so it never runs by itself.
-- =============================================================

drop policy if exists "team access" on public.clients;
create policy "team access" on public.clients for all to authenticated
  using ((select public.has_any_section(array['home','applications','clients','pipeline','tasks','finance'])))
  with check ((select public.has_any_section(array['home','applications','clients','pipeline','tasks','finance'])));

drop policy if exists "team access" on public.tasks;
create policy "team access" on public.tasks for all to authenticated
  using ((select public.has_any_section(array['home','tasks','clients','pipeline'])))
  with check ((select public.has_any_section(array['home','tasks','clients','pipeline'])));
