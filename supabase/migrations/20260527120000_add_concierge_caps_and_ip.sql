-- ============================================================================
-- Concierge cost-protection migration:
--   • Per-hotel daily + monthly conversation caps (default 200 / 1000)
--   • IP address captured on each session for per-IP rate limiting
--   • Index for fast IP-based lookups in the rate-limit query
-- ============================================================================

ALTER TABLE public.concierge_hotels
  ADD COLUMN daily_conv_cap   INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN monthly_conv_cap INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE public.concierge_sessions
  ADD COLUMN ip_address TEXT;

CREATE INDEX concierge_sessions_ip_started_idx
  ON public.concierge_sessions(ip_address, started_at DESC);

-- Generous starting caps for the live demo while we collect real usage data.
-- Once real hotels are paying we'll tighten these per their tier.
UPDATE public.concierge_hotels
SET    daily_conv_cap = 500, monthly_conv_cap = 5000
WHERE  slug = 'ivory-suites';
