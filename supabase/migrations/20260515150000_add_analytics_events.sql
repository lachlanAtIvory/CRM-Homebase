-- ============================================================================
-- Website analytics — tracks pageviews + heartbeats from the agentivory.com
-- site (and future per-client sites). One row per event.
-- ============================================================================
CREATE TABLE public.analytics_events (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id      TEXT         NOT NULL DEFAULT 'agentivory',
  session_id   TEXT         NOT NULL,
  visitor_id   TEXT,
  event_type   TEXT         NOT NULL CHECK (event_type IN ('pageview','heartbeat')),
  path         TEXT,
  referrer     TEXT,
  country      TEXT,
  device       TEXT,
  browser      TEXT,
  os           TEXT,
  created_at   TIMESTAMPTZ  DEFAULT now() NOT NULL
);

-- Hot indices for the dashboard queries
CREATE INDEX analytics_events_created_idx        ON public.analytics_events(created_at DESC);
CREATE INDEX analytics_events_session_idx        ON public.analytics_events(session_id);
CREATE INDEX analytics_events_type_created_idx   ON public.analytics_events(event_type, created_at DESC);
CREATE INDEX analytics_events_site_created_idx   ON public.analytics_events(site_id, created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Only authenticated CRM users can READ the events — public never queries
-- this table directly. INSERTs happen via the /api/track route which uses
-- the service-role key, bypassing RLS.
CREATE POLICY "authenticated read analytics"
  ON public.analytics_events FOR SELECT
  TO authenticated
  USING (true);

-- Realtime for the live "active right now" counter
ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_events;
