-- Hotel coordinates for live weather/transport context in the Ivory
-- Concierge prompt. Open-Meteo (free, no key) needs lat+lng.
ALTER TABLE public.concierge_hotels
  ADD COLUMN lat NUMERIC(9, 6),
  ADD COLUMN lng NUMERIC(9, 6);

-- Pre-fill Mantra Sydney Central (7 Wentworth Ave, Haymarket)
UPDATE public.concierge_hotels
SET lat = -33.8788, lng = 151.2104
WHERE slug = 'mantra';
