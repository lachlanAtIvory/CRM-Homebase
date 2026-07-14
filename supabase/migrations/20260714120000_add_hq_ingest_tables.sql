-- Agent Ivory HQ — Phase 1: ingest tables
--
-- Six tables that every n8n workflow writes into via POST /api/ingest:
--   hq_clients      — signed, live clients (Kenny physio, dental practice).
--                     Named hq_clients because public.clients already holds
--                     scraped pipeline leads for the CRM's deals flow.
--   calls           — every AI-handled call (Retell, chat widget).
--   prospects       — outbound sales targets (mystery shop / cold call / email).
--   prospect_events — activity log per prospect (mystery calls, demos, notes).
--   outreach_events — channel-level outreach telemetry (email opens, replies).
--   jobs            — async agent runs fired from the /agents page (Phase 2).
--
-- Conventions match the initial schema: uuid PKs, timestamptz, RLS with an
-- authenticated-users full-access policy (the ingest endpoint itself uses the
-- service role key, which bypasses RLS). Enum-ish fields use text + check
-- constraints so new values are a one-line ALTER, not a type migration.

-- =============================================================
-- hq_clients
-- =============================================================

create table public.hq_clients (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  vertical            text not null default 'other'
                      check (vertical in ('physio','chiro','dental','cosmetic','other')),
  status              text not null default 'active',
  cliniko_or_pms_type text,
  created_at          timestamptz not null default now()
);

-- =============================================================
-- calls
-- =============================================================

create table public.calls (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.hq_clients(id) on delete set null,
  source           text not null default 'other'
                   check (source in ('retell','chat_widget','other')),
  external_call_id text,
  caller_number    text,
  started_at       timestamptz,
  duration_seconds integer,
  outcome          text
                   check (outcome in ('booked','message_taken','enquiry','abandoned','other')),
  transcript       text,
  summary          text,
  raw_payload      jsonb,
  created_at       timestamptz not null default now()
);

create index calls_client_id_idx        on public.calls (client_id);
create index calls_started_at_idx       on public.calls (started_at desc);
create index calls_external_call_id_idx on public.calls (external_call_id);

-- =============================================================
-- prospects
-- =============================================================

create table public.prospects (
  id             uuid primary key default gen_random_uuid(),
  business_name  text not null,
  vertical       text,
  location       text,
  phone          text,
  email          text,
  contact_name   text,
  contact_role   text,
  source         text
                 check (source in ('hiring_ad','list','referral')),
  pipeline_stage text not null default 'new'
                 check (pipeline_stage in ('new','mystery_shopped','contacted','replied','demo_booked','won','lost')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

create index prospects_pipeline_stage_idx on public.prospects (pipeline_stage);

-- =============================================================
-- prospect_events
-- =============================================================
-- Mystery call detail json supports: call_time, rings, answered (bool),
-- went_to_voicemail (bool), callback_received (bool), capture_attempted
-- (bool), notes. An `actor` column (ryan/lachlan/system) lands in the
-- Phase 4 scoreboard migration.

create table public.prospect_events (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  type        text not null
              check (type in ('mystery_call','cold_call','email_sent','email_opened','email_replied','dm_sent','demo','note')),
  occurred_at timestamptz not null default now(),
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index prospect_events_prospect_id_idx on public.prospect_events (prospect_id);
create index prospect_events_occurred_at_idx on public.prospect_events (occurred_at desc);
create index prospect_events_type_idx        on public.prospect_events (type);

-- =============================================================
-- outreach_events
-- =============================================================

create table public.outreach_events (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  channel     text not null
              check (channel in ('email','phone','dm')),
  event       text not null
              check (event in ('sent','opened','clicked','replied','bounced','unsubscribed')),
  campaign    text,
  occurred_at timestamptz not null default now(),
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index outreach_events_prospect_id_idx on public.outreach_events (prospect_id);
create index outreach_events_occurred_at_idx on public.outreach_events (occurred_at desc);
create index outreach_events_event_idx       on public.outreach_events (event);

-- =============================================================
-- jobs
-- =============================================================

create table public.jobs (
  id         uuid primary key default gen_random_uuid(),
  agent      text not null,
  status     text not null default 'queued'
             check (status in ('queued','running','done','failed')),
  input      jsonb,
  result     jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create index jobs_status_idx     on public.jobs (status);
create index jobs_created_at_idx on public.jobs (created_at desc);

-- =============================================================
-- RLS — same "auth full access" policy as every other CRM table.
-- The ingest endpoint + n8n callbacks use the service role key (bypasses
-- RLS); dashboard pages read as authenticated users.
-- =============================================================

alter table public.hq_clients      enable row level security;
alter table public.calls           enable row level security;
alter table public.prospects       enable row level security;
alter table public.prospect_events enable row level security;
alter table public.outreach_events enable row level security;
alter table public.jobs            enable row level security;

create policy "auth full access"
  on public.hq_clients for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.calls for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.prospects for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.prospect_events for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.outreach_events for all to authenticated
  using (true) with check (true);

create policy "auth full access"
  on public.jobs for all to authenticated
  using (true) with check (true);
