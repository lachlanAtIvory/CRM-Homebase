-- =============================================================
-- Client invoices — uploaded PDFs that feed the Earnings widgets.
--
-- No invoice generator: invoices are made elsewhere (Stripe later) and
-- uploaded to the client's page. Earnings count an invoice only once it's
-- marked PAID (cash basis), by the date it was paid. Unpaid invoices show
-- separately as "outstanding".
--
-- When Stripe lands, its webhook can just flip status -> 'paid' on this
-- same table (add a stripe_payment_id column then); nothing to redo.
--
-- TODO(roles): these hold financial data. When the roles/permissions work
-- ships, replace the blanket "authenticated" policy with manager-only.
-- =============================================================

create table public.client_invoices (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,

  invoice_number text not null,
  kind           text not null default 'setup'
                 check (kind in ('setup', 'retainer', 'other')),
  issued_on      date not null,
  amount_aud     numeric(12, 2) not null check (amount_aud > 0),   -- total due, as invoiced

  status         text not null default 'outstanding'
                 check (status in ('outstanding', 'paid')),
  paid_on        date,

  file_path      text not null,   -- object path inside the private 'invoices' bucket
  file_name      text not null,   -- original file name, display only
  notes          text,
  uploaded_by    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- paid <=> has a paid date
  constraint client_invoices_paid_consistency
    check ((status = 'paid') = (paid_on is not null))
);

-- The same invoice can't be recorded twice (case-insensitive)
create unique index client_invoices_number_key
  on public.client_invoices (lower(invoice_number));

create index client_invoices_client_idx  on public.client_invoices (client_id);
create index client_invoices_paid_on_idx on public.client_invoices (paid_on)
  where status = 'paid';

create trigger client_invoices_set_updated_at
  before update on public.client_invoices
  for each row execute function public.set_updated_at();

alter table public.client_invoices enable row level security;

create policy "authenticated full access to client_invoices"
  on public.client_invoices for all to authenticated
  using (true) with check (true);

-- =============================================================
-- Private storage bucket for the PDFs (they contain bank details).
-- No storage policies on purpose: with none, only the server (service
-- role) can read or write, and files are only ever opened through a
-- short-lived signed URL after a session check.
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;
