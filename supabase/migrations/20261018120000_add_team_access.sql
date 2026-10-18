-- =============================================================
-- Team access — who can sign in, and what each person can see.
--
-- STEP 1 of 2. Safe and additive: it adds tables and helper functions and
-- changes nothing that exists. The app starts using it straight away to
-- decide who gets into which section. (Step 2, the next migration, is what
-- locks the database itself.)
--
-- Two kinds of person:
--   manager   Ryan and Lachlan. Everything, including this Team screen.
--             They are also listed in the ALLOWED_EMAILS environment
--             variable, which always wins, so they can never be locked out.
--   member    Anyone else (e.g. the cold caller). Sees only the sections
--             switched on for them, in Settings > Team.
--
-- Adding someone = inserting a row with status 'invited' BEFORE they have
-- ever signed in. When they sign in with Google using that email they are
-- let in automatically and the row flips to 'active'.
--
-- Only the app (service role) writes these tables. A signed-in person can
-- read their own row and nothing else; managers can read everyone's.
-- =============================================================

create table public.team_members (
  id              uuid primary key default gen_random_uuid(),
  email           text not null check (email = lower(email) and email like '%@%'),
  name            text,
  role            text not null default 'member' check (role in ('manager', 'member')),
  -- Section keys this member can see (see src/lib/hq/access.ts). Managers ignore this.
  sections        text[] not null default '{}',
  status          text not null default 'invited' check (status in ('invited', 'active', 'deactivated')),
  invited_by      text,
  first_login_at  timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index team_members_email_idx on public.team_members (email);

create trigger team_members_set_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

-- A log of who changed whose access, and when.
create table public.team_audit (
  id            uuid primary key default gen_random_uuid(),
  actor         text not null,
  action        text not null,
  target_email  text,
  detail        jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

create index team_audit_at_idx on public.team_audit (at desc);

-- -------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read team_members
-- whatever the caller's own permissions are (no policy recursion).
-- They look the caller up by the email in their sign-in token.
-- -------------------------------------------------------------

create or replace function public.is_manager()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select m.role = 'manager' and m.status <> 'deactivated'
    from public.team_members m
    where m.email = lower(auth.jwt() ->> 'email')
    limit 1
  ), false)
$$;

-- True for managers, and for a member who has at least one of the wanted sections.
create or replace function public.has_any_section(wanted text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select m.status <> 'deactivated' and (m.role = 'manager' or m.sections && wanted)
    from public.team_members m
    where m.email = lower(auth.jwt() ->> 'email')
    limit 1
  ), false)
$$;

-- Step 2 flips this to true. The Team screen reads it to show whether the database lock is on.
create or replace function public.rls_hardened()
returns boolean
language sql stable
as $$ select false $$;

revoke all on function public.is_manager() from public;
revoke all on function public.has_any_section(text[]) from public;
revoke all on function public.rls_hardened() from public;
grant execute on function public.is_manager() to authenticated, service_role;
grant execute on function public.has_any_section(text[]) to authenticated, service_role;
grant execute on function public.rls_hardened() to authenticated, service_role;

-- -------------------------------------------------------------
-- Row level security
-- -------------------------------------------------------------

alter table public.team_members enable row level security;
alter table public.team_audit   enable row level security;

create policy "read own team row"
  on public.team_members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

create policy "managers read the team"
  on public.team_members for select to authenticated
  using ((select public.is_manager()));

create policy "managers read the audit log"
  on public.team_audit for select to authenticated
  using ((select public.is_manager()));

-- No insert / update / delete policies on purpose: only the app's
-- server (service role) can change who is on the team.
