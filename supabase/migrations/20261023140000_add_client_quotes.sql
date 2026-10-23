-- =============================================================
-- Quotes that belong to a client, and the quote kept with an application.
--
-- The Quote Builder used to keep quotes in one browser only. Now a quote can be
-- tied to a CRM client and is kept here (one live quote per client). Pushing it
-- to the application copies its products and price across and stores the quote
-- itself on the application, so the application is built from the same answers
-- the sales call produced.
--
-- Safe to run more than once.
-- =============================================================

create table if not exists public.client_quotes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique references public.clients(id) on delete cascade,
  -- the Quote Builder's own state (everything that was filled in)
  state       jsonb not null,
  -- the headline of it (products, tier, totals), so lists don't have to re-price it
  summary     jsonb not null default '{}'::jsonb,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists client_quotes_set_updated_at on public.client_quotes;
create trigger client_quotes_set_updated_at
  before update on public.client_quotes
  for each row execute function public.set_updated_at();

alter table public.client_quotes enable row level security;

-- Same people who can work with quotes or applications (managers always can).
drop policy if exists "team access" on public.client_quotes;
create policy "team access" on public.client_quotes for all to authenticated
  using ((select public.has_any_section(array['quote','applications'])))
  with check ((select public.has_any_section(array['quote','applications'])));

-- The quote an application was built from, and when it was pushed.
alter table public.applications add column if not exists quote_snapshot  jsonb;
alter table public.applications add column if not exists quote_pushed_at timestamptz;
