-- =============================================================
-- Motivation tracker (cold-call dashboard)
--
-- 1. prospect_events.prospect_id becomes nullable: the motivation
--    counters log dials/voicemails/no-answers that aren't tied to a
--    known prospect yet.
-- 2. actor column on prospect_events + outreach_events (pulled forward
--    from the Phase 4 scoreboard spec) so activity is attributable to
--    ryan / lachlan / system.
-- =============================================================

alter table public.prospect_events
  alter column prospect_id drop not null;

alter table public.prospect_events
  add column if not exists actor text not null default 'system'
  check (actor in ('ryan', 'lachlan', 'system'));

alter table public.outreach_events
  add column if not exists actor text not null default 'system'
  check (actor in ('ryan', 'lachlan', 'system'));

create index if not exists prospect_events_actor_idx
  on public.prospect_events (actor, occurred_at desc);
