-- =============================================================
-- Tasks get an owner, and Tasks no longer exposes client records.
--
-- Until now every task was shared with everyone who could see Tasks, and
-- seeing Tasks also let a person read every client record (tasks show the
-- client's name). Before the cold caller (Jan) gets the Tasks section:
--
--   tasks.created_by    who made it (filled in automatically from the sign-in)
--   tasks.assigned_to   who it's for (set from the Tasks page by a manager)
--
--   Managers      see and change every task, as before.
--   Everyone else sees only tasks they created or that are assigned to them.
--   Tasks that already exist have no owner, so only managers see those.
--
-- The 'tasks' section is also removed from who can read clients. The Tasks
-- page already copes with a client's name being unavailable.
--
-- Also: call_leads.callback_by records who promised a callback, so reminders
-- go to that person and not to everyone with the Call List.
--
-- To undo: supabase/rollbacks/20261019130000_undo_tasks_ownership.sql
-- =============================================================

alter table public.tasks
  add column if not exists created_by  text default lower(auth.jwt() ->> 'email'),
  add column if not exists assigned_to text;

create index if not exists tasks_assigned_to_idx on public.tasks (assigned_to);
create index if not exists tasks_created_by_idx  on public.tasks (created_by);

alter table public.call_leads
  add column if not exists callback_by text;

create index if not exists call_leads_callback_by_idx on public.call_leads (callback_by) where status = 'callback';

-- Clients: no longer readable just because someone can see Tasks.
drop policy if exists "team access" on public.clients;
create policy "team access" on public.clients for all to authenticated
  using ((select public.has_any_section(array['home','applications','clients','pipeline','finance'])))
  with check ((select public.has_any_section(array['home','applications','clients','pipeline','finance'])));

-- Tasks: managers see all; others only their own.
drop policy if exists "team access" on public.tasks;
create policy "team access" on public.tasks for all to authenticated
  using (
    (select public.is_manager())
    or (
      (select public.has_any_section(array['home','tasks','clients','pipeline']))
      and (created_by = lower(auth.jwt() ->> 'email') or assigned_to = lower(auth.jwt() ->> 'email'))
    )
  )
  with check (
    (select public.is_manager())
    or (
      (select public.has_any_section(array['home','tasks','clients','pipeline']))
      and (created_by = lower(auth.jwt() ->> 'email') or assigned_to = lower(auth.jwt() ->> 'email'))
    )
  );
