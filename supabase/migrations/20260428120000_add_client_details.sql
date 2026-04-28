-- Add website and active_tools fields to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS website      TEXT,
  ADD COLUMN IF NOT EXISTS active_tools TEXT[] DEFAULT '{}';
