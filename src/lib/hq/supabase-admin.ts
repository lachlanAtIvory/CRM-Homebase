import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — server-only, bypasses RLS.
 * Used for the private invoice bucket, which deliberately has no storage
 * policies: only code that has already checked the user's session may
 * touch it, via this client.
 */
export const INVOICE_BUCKET = "invoices";

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** True when an error means "the invoices migration hasn't been run yet". */
export function isSetupError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||          // Postgres: relation does not exist
    err.code === "PGRST205" ||       // PostgREST: table not in schema cache
    msg.includes("bucket not found")
  );
}
