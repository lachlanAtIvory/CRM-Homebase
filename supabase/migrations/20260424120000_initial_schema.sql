-- Agent Ivory CRM — initial schema
-- Phase 1: core tables, RLS (authenticated-users policy), realtime, triggers.

-- =============================================================
-- Enums
-- =============================================================

create type pipeline_stage as enum (
  'call_booked',
  'document_sent',
  'quoted',
  'approved',
  'onboarding',
  'final_testing',
  'activated',
  'live_client',
  'closed_lost',
  'paused'
);

-- =============================================================
-- Shared trigger: keep updated_at fresh
-- =============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================
-- clients
-- =============================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  job_advert_url text,
  scraped_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- =============================================================
-- deals
-- =============================================================

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  current_stage pipeline_stage not null default 'call_booked',
  deal_value_aud numeric(12, 2),
  invoice_url text,
  sheet_row_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_client_id_idx on public.deals(client_id);
create index deals_current_stage_idx on public.deals(current_stage);
create index deals_sheet_row_id_idx on public.deals(sheet_row_id);

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- =============================================================
-- stage_history + auto-logging trigger
-- =============================================================

create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage pipeline_stage,
  to_stage pipeline_stage not null,
  changed_at timestamptz not null default now()
);

create index stage_history_deal_id_changed_at_idx
  on public.stage_history(deal_id, changed_at);
create index stage_history_to_stage_changed_at_idx
  on public.stage_history(to_stage, changed_at);

create or replace function public.log_stage_change()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.stage_history (deal_id, from_stage, to_stage)
    values (new.id, null, new.current_stage);
  elsif TG_OP = 'UPDATE'
        and new.current_stage is distinct from old.current_stage then
    insert into public.stage_history (deal_id, from_stage, to_stage)
    values (new.id, old.current_stage, new.current_stage);
  end if;
  return new;
end;
$$;

create trigger deals_log_stage_change_insert
  after insert on public.deals
  for each row execute function public.log_stage_change();

create trigger deals_log_stage_change_update
  after update on public.deals
  for each row execute function public.log_stage_change();

-- =============================================================
-- meetings
-- =============================================================

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  attendees text[],
  meeting_link text,
  linked_client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetings_start_time_idx on public.meetings(start_time);
create index meetings_linked_client_id_idx on public.meetings(linked_client_id);

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- =============================================================
-- agents
-- =============================================================

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  created_at timestamptz not null default now()
);

-- =============================================================
-- agent_activity
-- =============================================================

create table public.agent_activity (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  event_type text not null,
  count integer not null default 1,
  occurred_at timestamptz not null default now()
);

create index agent_activity_agent_occurred_idx
  on public.agent_activity(agent_id, occurred_at);
create index agent_activity_event_occurred_idx
  on public.agent_activity(event_type, occurred_at);

-- =============================================================
-- Row-Level Security: Option A
--   Any authenticated user has full read/write access.
--   Email allow-list is enforced at sign-in time (middleware).
-- =============================================================

alter table public.clients enable row level security;
alter table public.deals enable row level security;
alter table public.stage_history enable row level security;
alter table public.meetings enable row level security;
alter table public.agents enable row level security;
alter table public.agent_activity enable row level security;

create policy "auth full access"
  on public.clients for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.deals for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.stage_history for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.meetings for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.agents for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.agent_activity for all to authenticated
  using (true) with check (true);

-- =============================================================
-- Realtime replication (tables the dashboard will subscribe to)
-- =============================================================

alter publication supabase_realtime add table public.deals;
alter publication supabase_realtime add table public.stage_history;
alter publication supabase_realtime add table public.meetings;
alter publication supabase_realtime add table public.agent_activity;
