-- =============================================================
-- Call list — the scraped lead list the cold caller works through.
--
-- The Google Sheet stays the scraper's output. Leads are imported into
-- call_leads (paste or upload at /call-list/import), and everything the
-- caller does — outcome, notes, callbacks, bookings — lives here, so the
-- sheet is never edited and a re-import can't overwrite his work.
--
-- Dedupe: lead_key is unique. It is the Google Maps URL when the row has
-- one, else the phone number, else name + address.
--
-- TODO(roles): "authenticated full access" matches every other table for
-- now. When roles ship, the caller should get read/write on these two
-- tables only, and import should be manager-only.
-- =============================================================

create table public.call_leads (
  id              uuid primary key default gen_random_uuid(),
  lead_key        text not null,

  business_name   text not null,
  phone           text,                 -- exactly as scraped
  phone_e164      text,                 -- +61… when it parses as an AU number
  website         text,
  email           text,
  address         text,
  category        text,
  rating          numeric(3,1),
  review_count    integer,
  google_maps_url text,
  extra           jsonb not null default '{}'::jsonb,   -- any other sheet columns

  status          text not null default 'new'
                  check (status in (
                    'new', 'no_answer', 'voicemail', 'callback',
                    'not_interested', 'wrong_number', 'do_not_call', 'booked'
                  )),
  attempts        integer not null default 0,
  last_called_at  timestamptz,
  callback_at     timestamptz,
  client_id       uuid references public.clients(id) on delete set null,   -- set when a sales call is booked

  imported_by     text,
  imported_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index call_leads_lead_key_idx  on public.call_leads (lead_key);
create index call_leads_queue_idx            on public.call_leads (status, attempts, imported_at);
create index call_leads_callback_idx         on public.call_leads (callback_at) where status = 'callback';
create index call_leads_phone_idx            on public.call_leads (phone_e164);

alter table public.call_leads enable row level security;
create policy "authenticated full access to call_leads"
  on public.call_leads for all to authenticated
  using (true) with check (true);

create trigger call_leads_set_updated_at
  before update on public.call_leads
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- Notes / activity timeline, one row per note or call outcome
-- -------------------------------------------------------------

create table public.call_lead_notes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.call_leads(id) on delete cascade,
  outcome      text not null
               check (outcome in (
                 'note', 'no_answer', 'voicemail', 'not_interested',
                 'wrong_number', 'do_not_call', 'callback', 'booked'
               )),
  body         text,
  actor        text not null default 'system',
  created_by   text,                                  -- signed-in email
  occurred_at  timestamptz not null default now()
);

create index call_lead_notes_lead_idx on public.call_lead_notes (lead_id, occurred_at desc);

alter table public.call_lead_notes enable row level security;
create policy "authenticated full access to call_lead_notes"
  on public.call_lead_notes for all to authenticated
  using (true) with check (true);

-- -------------------------------------------------------------
-- A third person now logs calls, so the scoreboard needs a 'caller'
-- actor alongside ryan / lachlan / system. The original check was
-- added inline (so its name is generated); find and replace it by
-- looking at the constraint's definition rather than guessing a name.
-- -------------------------------------------------------------

do $$
declare
  t text;
  c record;
begin
  foreach t in array array['prospect_events', 'outreach_events'] loop
    for c in
      select conname
      from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%actor%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format(
      'alter table public.%I add constraint %I check (actor in (''ryan'', ''lachlan'', ''caller'', ''system''))',
      t, t || '_actor_check'
    );
  end loop;
end $$;
