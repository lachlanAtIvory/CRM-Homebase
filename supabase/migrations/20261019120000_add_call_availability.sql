-- =============================================================
-- Call availability — when Ryan and Lachlan can take sales calls.
--
-- The cold caller books a sales call by tapping a time. The times he is
-- offered are: each person's weekly window, minus anything they've blocked
-- out, minus anything already on the shared Ivory calendar.
--
-- All times are Sydney time. weekday: 0 = Sunday ... 6 = Saturday.
-- One window per person per day for now (e.g. Ryan Mon 08:00-13:00).
--
-- Seeded with the starting hours:
--   Lachlan  Wed, Fri, Sat, Sun   08:00-18:00
--   Ryan     Mon-Fri 08:00-13:00; Sat, Sun 08:00-18:00
-- Edit them any time in Settings > Call availability.
--
-- Access (the database lock is on): the Call List and Calendar sections can
-- READ the hours; only managers can change them.
-- =============================================================

create table public.availability_windows (
  id          uuid primary key default gen_random_uuid(),
  person      text not null check (person in ('ryan', 'lachlan')),
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_time > start_time),
  unique (person, weekday)
);

create trigger availability_windows_set_updated_at
  before update on public.availability_windows
  for each row execute function public.set_updated_at();

-- Time off / one-off unavailable periods (holidays, a dentist appointment).
create table public.availability_blocks (
  id          uuid primary key default gen_random_uuid(),
  person      text not null check (person in ('ryan', 'lachlan')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index availability_blocks_person_idx on public.availability_blocks (person, starts_at);

alter table public.availability_windows enable row level security;
alter table public.availability_blocks  enable row level security;

create policy "read availability" on public.availability_windows
  for select to authenticated
  using ((select public.has_any_section(array['call-list', 'calendar', 'settings'])));
create policy "managers change availability" on public.availability_windows
  for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

create policy "read time off" on public.availability_blocks
  for select to authenticated
  using ((select public.has_any_section(array['call-list', 'calendar', 'settings'])));
create policy "managers change time off" on public.availability_blocks
  for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));

-- Starting hours
insert into public.availability_windows (person, weekday, start_time, end_time) values
  ('lachlan', 3, '08:00', '18:00'),
  ('lachlan', 5, '08:00', '18:00'),
  ('lachlan', 6, '08:00', '18:00'),
  ('lachlan', 0, '08:00', '18:00'),
  ('ryan', 1, '08:00', '13:00'),
  ('ryan', 2, '08:00', '13:00'),
  ('ryan', 3, '08:00', '13:00'),
  ('ryan', 4, '08:00', '13:00'),
  ('ryan', 5, '08:00', '13:00'),
  ('ryan', 6, '08:00', '18:00'),
  ('ryan', 0, '08:00', '18:00')
on conflict (person, weekday) do nothing;
