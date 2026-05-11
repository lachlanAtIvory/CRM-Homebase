-- ============================================================================
-- Products catalog — drives the application form's product checkboxes + quote
-- ============================================================================
CREATE TABLE public.products (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key             TEXT UNIQUE NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  upfront_cost_aud  NUMERIC(10,2) NOT NULL DEFAULT 0,
  monthly_cost_aud  NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access to products"
  ON public.products FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the initial product catalogue with the agreed pricing
INSERT INTO public.products (key, label, description, upfront_cost_aud, monthly_cost_aud, sort_order) VALUES
  ('agent_ivory',   'Agent Ivory',       'Voice receptionist — inbound call handling, IVR, voice training', 3500, 1200, 1),
  ('webchat',       'Webchat Tool',      'Website chat widget trained on your docs & FAQs',                  1200,  350, 2),
  ('outreach',      'Outreach Tool',     'Voice outbound — dialler, call lists, compliance',                 4000, 1500, 3),
  ('email_agent',   'Email Agent',       'Inbox handling, automated replies, integrations',                  1500,  450, 4),
  ('report_gen',    'Report Generator',  'Auto-generated business reports from your data',                    800,  250, 5),
  ('calendar_sync', 'Calendar Sync',     'Google Calendar / Calendly two-way booking sync',                   600,  200, 6);

-- ============================================================================
-- Applications — submissions from the Launch Application form
-- ============================================================================
CREATE TABLE public.applications (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Link back to CRM client (set when application is submitted)
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Client Details
  company_name      TEXT NOT NULL,
  owner_name        TEXT,
  contact_email     TEXT,
  contact_phone     TEXT,

  -- Business Details
  abn               TEXT,
  trading_address   TEXT,

  -- Product Selection — array of products.key values
  selected_products TEXT[] NOT NULL DEFAULT '{}',

  -- Calculated totals (snapshot at submit time, so prices changing later
  -- doesn't retroactively change the invoiced amount)
  upfront_total_aud NUMERIC(10,2) NOT NULL DEFAULT 0,
  monthly_total_aud NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Goals & Requirements
  goals             TEXT,
  requirements      TEXT,

  -- Status & invoice tracking
  status            TEXT NOT NULL DEFAULT 'draft',     -- 'draft' | 'submitted' | 'invoiced' | 'paid'
  invoice_number    TEXT,
  invoice_sent_at   TIMESTAMPTZ,

  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX applications_client_id_idx ON public.applications(client_id);
CREATE INDEX applications_status_idx    ON public.applications(status);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access to applications"
  ON public.applications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER applications_set_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
