-- Add Services list + Booking Platform fields to the application form

ALTER TABLE public.applications
  ADD COLUMN services               JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN booking_platform_name  TEXT,
  ADD COLUMN booking_platform_url   TEXT,
  ADD COLUMN booking_platform_notes TEXT;

-- services entry shape: { "id": string, "name": string }
-- team_members entries now also carry: service_ids: string[]  + other_services: string
