-- Add team/specialist info to the application form
ALTER TABLE public.applications
  ADD COLUMN uses_single_calendar BOOLEAN,
  ADD COLUMN team_members JSONB NOT NULL DEFAULT '[]';

-- Each team_members entry has the shape:
-- {
--   "name":                  string,
--   "position":              string,
--   "services":              string,
--   "has_separate_calendar": boolean,   -- only used when uses_single_calendar = true
--   "integrate_calendar":    boolean    -- only used when uses_single_calendar = false
-- }
