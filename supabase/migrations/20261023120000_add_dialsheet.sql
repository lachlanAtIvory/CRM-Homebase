-- =============================================================
-- DialSheet — the dialer the cold caller phones from.
--
-- DialSheet tells the CRM about every finished call (a signed webhook,
-- /api/dialsheet/webhook). Each call becomes a row in call_activity, linked to
-- the lead that was called, so the lead's history shows the call with its
-- length, how it ended, the notes typed in DialSheet and its AI summary.
--
-- Only the app's server (service role) writes these tables. The Call List can
-- read call_activity; the event log is managers-only.
--
-- Safe to run more than once, and safe whether or not the earlier JustCall
-- version of this migration (20261020120000_add_justcall.sql) was ever run:
-- that version's table is reused and brought up to date. Its justcall_events
-- log table, if it exists, is left alone and is simply no longer used.
-- =============================================================

create table if not exists public.call_activity (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null default 'dialsheet',
  -- the phone system's own id for the call
  provider_call_id     text not null,
  lead_id              uuid references public.call_leads(id) on delete set null,
  source               text not null default 'dialsheet',

  direction            text check (direction in ('outgoing', 'incoming')),
  call_type            text check (call_type in ('answered', 'unanswered', 'missed', 'voicemail', 'failed', 'other')),
  raw_type             text,                -- the phone system's own status word, kept for reference

  contact_number       text,                -- as the phone system has it
  contact_e164         text,                -- normalised, used to match leads

  started_at           timestamptz,
  duration_seconds     integer,

  disposition          text,                -- the outcome picked in DialSheet
  notes                text,                -- notes typed on the call in DialSheet
  summary              text,                -- DialSheet's AI summary
  next_steps           text,                -- DialSheet's AI suggested next steps
  recording_url        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, provider_call_id)
);

-- Bring a table created by the earlier JustCall version up to date.
alter table public.call_activity add column if not exists summary    text;
alter table public.call_activity add column if not exists next_steps text;
alter table public.call_activity drop constraint if exists call_activity_source_check;
alter table public.call_activity alter column source   set default 'dialsheet';
alter table public.call_activity alter column provider set default 'dialsheet';

create index if not exists call_activity_lead_idx on public.call_activity (lead_id, started_at desc);
create index if not exists call_activity_e164_idx on public.call_activity (contact_e164);

drop trigger if exists call_activity_set_updated_at on public.call_activity;
create trigger call_activity_set_updated_at
  before update on public.call_activity
  for each row execute function public.set_updated_at();

-- What the webhook received and what we did with it (for the DialSheet settings screen).
create table if not exists public.dialsheet_events (
  id               uuid primary key default gen_random_uuid(),
  received_at      timestamptz not null default now(),
  event_type       text,
  provider_call_id text,
  outcome          text not null check (outcome in ('processed', 'unmatched', 'ignored', 'rejected', 'error')),
  lead_id          uuid references public.call_leads(id) on delete set null,
  detail           text
);

create index if not exists dialsheet_events_received_idx on public.dialsheet_events (received_at desc);

alter table public.call_activity   enable row level security;
alter table public.dialsheet_events enable row level security;

drop policy if exists "read call activity" on public.call_activity;
create policy "read call activity" on public.call_activity
  for select to authenticated
  using ((select public.has_any_section(array['call-list'])));

drop policy if exists "managers read the DialSheet log" on public.dialsheet_events;
create policy "managers read the DialSheet log" on public.dialsheet_events
  for select to authenticated
  using ((select public.is_manager()));

-- No insert / update / delete policies on purpose: only the app's server writes these.
