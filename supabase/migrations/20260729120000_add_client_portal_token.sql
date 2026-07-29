-- =============================================================
-- Client portal (Phase 5): unguessable per-client token for the
-- public read-only report page at /client/[token].
--
-- 192 bits of randomness (24 bytes, hex-encoded) — brute forcing the
-- token space is computationally infeasible, so this is the entire
-- access control for that route. Regenerating a client's token (done
-- from /client-portals in the CRM) instantly revokes the old link.
-- =============================================================

alter table public.hq_clients
  add column if not exists portal_token text unique
  default encode(gen_random_bytes(24), 'hex');

-- Backfill existing rows (the column default only applies to new inserts)
update public.hq_clients
  set portal_token = encode(gen_random_bytes(24), 'hex')
  where portal_token is null;

create index if not exists hq_clients_portal_token_idx
  on public.hq_clients (portal_token);
