-- =============================================================
-- JustCall — the dialer the cold caller phones from.
--
-- JustCall tells the CRM about every call it handles (a signed webhook,
-- /api/justcall/webhook). Each call becomes a row in call_activity, linked to
-- the lead that was called, so the lead's history shows the call with its
-- length, how it ended, and a link to the recording.
--
-- Only the app's server (service role) writes these tables. The Call List can
-- read call_activity; the event log is managers-only. Safe to run more than once.
-- =============================================================

create table if not exists public.call_activity (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null default 'justcall',
  -- JustCall's own id for the call (its numeric id, or the call_sid until one exists)
  provider_call_id     text not null,
  call_sid             text,
  lead_id              uuid references public.call_leads(id) on delete set null,
  source               text not null default 'justcall' check (source in ('justcall', 'sales_dialer')),

  direction            text check (direction in ('outgoing', 'incoming')),
  call_type            text check (call_type in ('answered', 'unanswered', 'missed', 'voicemail', 'failed', 'other')),
  raw_type             text,                -- JustCall's wording, kept for reference

  contact_number       text,                -- as JustCall sent it
  contact_e164         text,                -- normalised, used to match leads
  justcall_number      text,                -- our line
  agent_email          text,
  agent_name           text,

  started_at           timestamptz,
  duration_seconds     integer,
  conversation_seconds integer,

  disposition          text,
  notes                text,
  rating               integer,
  recording_url        text,
  voicemail_text       text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index if not exists call_activity_lead_idx  on public.call_activity (lead_id, started_at desc);
create index if not exists call_activity_e164_idx  on public.call_activity (contact_e164);
create index if not exists call_activity_sid_idx   on public.call_activity (call_sid);

drop trigger if exists call_activity_set_updated_at on public.call_activity;
create trigger call_activity_set_updated_at
  before update on public.call_activity
  for each row execute function public.set_updated_at();

-- What the webhook received and what we did with it (for the JustCall settings screen).
create table if not exists public.justcall_events (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  event_type       text,
  provider_call_id text,
  outcome          text not null check (outcome in ('processed', 'unmatched', 'ignored', 'rejected', 'error')),
  lead_id          uuid references public.call_leads(id) on delete set null,
  detail           text
);

create index if not exists justcall_events_received_idx on public.justcall_events (received_at desc);

alter table public.call_activity   enable row level security;
alter table public.justcall_events enable row level security;

drop policy if exists "read call activity" on public.call_activity;
create policy "read call activity" on public.call_activity
  for select to authenticated
  using ((select public.has_any_section(array['call-list'])));

drop policy if exists "managers read the JustCall log" on public.justcall_events;
create policy "managers read the JustCall log" on public.justcall_events
  for select to authenticated
  using ((select public.is_manager()));

-- No insert / update / delete policies on purpose: only the app's server writes these.
