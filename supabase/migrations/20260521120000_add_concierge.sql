-- ============================================================================
-- Ivory Concierge — multi-tenant AI hotel concierge
-- Guests scan a QR in their room → chat at /concierge/{slug}
-- ============================================================================

-- One row per hotel using the concierge
CREATE TABLE public.concierge_hotels (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT         UNIQUE NOT NULL,
  name        TEXT         NOT NULL,
  tagline     TEXT,
  brand_color TEXT         NOT NULL DEFAULT '#6c4bf1',
  logo_url    TEXT,
  address     TEXT,
  timezone    TEXT         NOT NULL DEFAULT 'Australia/Sydney',
  greeting    TEXT,
  client_id   UUID         REFERENCES public.clients(id) ON DELETE SET NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ  DEFAULT now() NOT NULL
);
CREATE INDEX concierge_hotels_slug_idx ON public.concierge_hotels(slug);

-- Hotel-specific Q&A facts (the AI uses these as ground truth)
CREATE TABLE public.concierge_facts (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id   UUID         NOT NULL REFERENCES public.concierge_hotels(id) ON DELETE CASCADE,
  category   TEXT,
  question   TEXT,
  answer     TEXT         NOT NULL,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT now() NOT NULL
);
CREATE INDEX concierge_facts_hotel_idx ON public.concierge_facts(hotel_id);

-- Local recommendations within walking/short-drive of the hotel
CREATE TABLE public.concierge_local (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     UUID         NOT NULL REFERENCES public.concierge_hotels(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  category     TEXT,                -- 'cafe', 'restaurant', 'pub', 'attraction', etc.
  distance     TEXT,                -- '4 min walk', '5 min walk', etc.
  hours        TEXT,                -- '7am-3pm daily', 'kitchen til 9pm', etc.
  description  TEXT,                -- short editorial blurb, the bot uses this verbatim
  tags         TEXT[]       DEFAULT '{}',  -- ['breakfast', 'late-night', 'rainy-day', etc.]
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  DEFAULT now() NOT NULL
);
CREATE INDEX concierge_local_hotel_idx ON public.concierge_local(hotel_id);

-- One per QR scan / browser session
CREATE TABLE public.concierge_sessions (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id   UUID         NOT NULL REFERENCES public.concierge_hotels(id) ON DELETE CASCADE,
  visitor_id TEXT,                  -- random ID from guest's localStorage
  user_agent TEXT,
  country    TEXT,
  started_at TIMESTAMPTZ  DEFAULT now() NOT NULL,
  last_seen_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX concierge_sessions_hotel_started_idx ON public.concierge_sessions(hotel_id, started_at DESC);

-- Every message in every session — drives the live activity feed + analytics
CREATE TABLE public.concierge_messages (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID         NOT NULL REFERENCES public.concierge_sessions(id) ON DELETE CASCADE,
  role       TEXT         NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT now() NOT NULL
);
CREATE INDEX concierge_messages_session_idx ON public.concierge_messages(session_id, created_at);

-- ============================================================================
-- RLS — public can READ hotel/facts/local (so guests can see the page).
-- Sessions and messages are written by the API only (service role bypasses RLS).
-- ============================================================================
ALTER TABLE public.concierge_hotels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_facts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_local   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_messages ENABLE ROW LEVEL SECURITY;

-- Public read for guest-facing data
CREATE POLICY "anyone read hotels" ON public.concierge_hotels FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anyone read facts"  ON public.concierge_facts  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anyone read local"  ON public.concierge_local  FOR SELECT TO anon, authenticated USING (true);

-- CRM users have full access for admin
CREATE POLICY "auth full hotels"   ON public.concierge_hotels   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full facts"    ON public.concierge_facts    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full local"    ON public.concierge_local    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full sessions" ON public.concierge_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full messages" ON public.concierge_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER concierge_hotels_set_updated_at
  BEFORE UPDATE ON public.concierge_hotels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Seed: Mantra Sydney Central + facts + local recs
-- ============================================================================
INSERT INTO public.concierge_hotels (slug, name, tagline, brand_color, address, timezone, greeting)
VALUES (
  'mantra',
  'Mantra Sydney Central',
  'Hotels, resorts & apartments',
  '#6c4bf1',
  '7 Wentworth Avenue, Sydney NSW 2000',
  'Australia/Sydney',
  'G''day! I''m Ivory, your hotel concierge. Ask me anything about Mantra Sydney Central or the area — restaurants, opening hours, things to do. What can I help with?'
);

-- Hotel facts (demo data — replace with reals before going live)
INSERT INTO public.concierge_facts (hotel_id, category, question, answer, sort_order) VALUES
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'arrival',  'What time is check-in?',     'Check-in opens at 2:00pm. Early check-in is available based on room availability — drop your bags at reception any time after 10am and we''ll text you when your room is ready.', 1),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'departure','What time is checkout?',     'Checkout is by 10:00am. Late checkout to 12pm is available for $40, just call reception. Express checkout: leave your key in the room, we''ll email your receipt.', 2),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'wifi',     'What is the wifi?',          'WiFi name: Mantra-Guest. Password: welcome2sydney (case-sensitive). High-speed throughout the building, free for all guests.', 3),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'frontdesk','When is front desk open?',   'Reception is staffed 24 hours. Press 0 from your room phone to reach us anytime.', 4),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'breakfast','Is there breakfast?',        'Continental breakfast is served 6:30am-10:00am weekdays, 7:00am-10:30am weekends, in the lobby restaurant. $24/adult, $12/child. Book at reception or just rock up.', 5),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'gym',      'Is there a gym?',            'Yes — 24-hour gym on Level 2. Cardio + free weights + Peloton. Tap your room key on the door. Towels provided.', 6),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'pool',     'Is there a pool?',           'Sorry, no pool at this property. The nearest public pool is Cook + Phillip Park Pool, a 12-minute walk — heated indoor + outdoor pools, day pass $8.', 7),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'parking',  'Is there parking?',          'Valet parking $55/night, in/out access. Self-park nearby at Wilson Sussex St ($28/day). Reception can book either.', 8),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'pets',     'Are pets allowed?',          'Sorry, no pets at this property except registered assistance animals.', 9),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'amenities','What''s in the room?',       'Tea/coffee setup with Nespresso pods, kettle, hairdryer, iron + board, in-room safe, Smart TV with Chromecast, mini-fridge, robes and slippers. Toiletries refreshed daily.', 10),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'roomservice','Is there room service?',   'In-room dining 6:30am-10:30pm. Menu in the room folder or scan the QR on the desk. After hours: vending on Level 3.', 11),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'laundry',  'Is there laundry?',          'Self-service guest laundry on Level 4 (24/7, $4 wash + $4 dry, change at reception). Same-day dry cleaning if dropped at reception before 9am, returned by 6pm.', 12),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'transit',  'How do I get to the airport?','Sydney Domestic + International airports are 20 min by car. Uber from the lobby ~$40-50. The Airport Link train from Central Station (3 min walk) is $20 and runs every 10 min, 5am-midnight.', 13),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'transit',  'How do I get to the harbour?', 'Circular Quay is a 10 min train ride from Central (3 min walk from hotel), or 15 min walk through Hyde Park if it''s a nice day.', 14),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'general',  'Emergency / fire / medical', 'Dial 000 for emergencies. Reception (press 0) for any in-hotel issue. Nearest hospital: Sydney Eye Hospital, 8 min by car. 24-hour pharmacy: Mascot Pharmacy at Central, 5 min walk.', 15);

-- Local recommendations (real picks from the user — perfect for Mantra Sydney Central / Haymarket)
INSERT INTO public.concierge_local (hotel_id, name, category, distance, hours, description, tags, sort_order) VALUES
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Noelle''s Cafe',            'cafe',       '4 min walk',         '7am-3pm daily',                    'Best eggs benedict I''ve ever had — guests rave about it.',                              ARRAY['breakfast','brunch','coffee'], 1),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Dutch Smuggler Coffee',     'cafe',       '2 min walk',         '6am-2pm weekdays',                 'Coffee + toasties, great for a grab-and-go before a meeting.',                            ARRAY['breakfast','coffee','quick'], 2),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Haymarket Hotel',           'pub',        'Across the street',  'Kitchen til 9pm, bar + pokies til 4am', 'Solid pub right opposite the hotel. Bistro food + late-night drinks.',               ARRAY['dinner','late-night','pub','drinks'], 3),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Great Southern Bar',        'pub',        '3 min walk',         'Lunch + dinner, til late',         '$25 steak-and-schooner Tuesdays. Killer schnitty any day.',                              ARRAY['dinner','pub','value','beer'], 4),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Market City Tavern',        'rooftop bar','3 min walk',         'Lunch til late',                   'Rooftop over Paddy''s Markets with the cheapest schooners in the CBD. Great for sunset.', ARRAY['drinks','rooftop','sunset','value'], 5),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Ho Jiak Haymarket',         'restaurant', '4 min walk',         '11am-11pm daily',                  'Malaysian — order the char kway teow with crab. That''s the move.',                       ARRAY['dinner','asian','late-night'], 6),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Chinatown Sizzling House',  'restaurant', '3 min walk',         '11am-9:30pm daily',                'Chinese sizzling plates with outdoor laneway seating. Casual, fast, great value.',        ARRAY['dinner','lunch','asian','outdoor'], 7),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Mr. Lam',                   'restaurant', '5 min walk',         'Til midnight daily',               'Sichuan-style group dining on Dixon St. Book ahead — it gets packed.',                    ARRAY['dinner','asian','group','late-night'], 8),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Hyde Park',                 'attraction', '10 min walk',        'Open 24 hours',                    'Sydney''s biggest city park — fig-tree avenues + the ANZAC Memorial. Great morning walk.', ARRAY['outdoor','free','walk','rainy-day-no'], 9),
  ((SELECT id FROM public.concierge_hotels WHERE slug = 'mantra'), 'Sydney Tower Eye',          'attraction', '12 min walk',        '11am-7pm daily',                   'Observation deck with 360° city views. Book online for sunset, it''s worth it.',          ARRAY['view','sightseeing','sunset','book-ahead'], 10);
