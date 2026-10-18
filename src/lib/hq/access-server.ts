import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowedEmail } from "@/lib/auth";
import {
  isMissingAccessSetup, normalizeEmail, parseSections, SECTION_KEYS, type Access,
} from "./access";

/**
 * Work out who a signed-in person is and what they may see.
 *
 * Safe to import from the middleware (edge): no Next.js or Node-only code here.
 *
 *   1. On the ALLOWED_EMAILS list  -> manager, full access. This always wins, so
 *      Ryan and Lachlan can never be locked out by a mistake in the Team screen.
 *   2. A row in team_members       -> that row's role and sections.
 *   3. Anything else               -> no access.
 */

export type AccessResult =
  | { ok: true; access: Access }
  | { ok: false; reason: "none" | "deactivated" | "error"; message?: string };

export async function resolveAccess(
  supabase: SupabaseClient,
  email: string | null | undefined,
): Promise<AccessResult> {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, reason: "none" };

  if (isAllowedEmail(e)) {
    return {
      ok: true,
      access: { email: e, name: null, role: "manager", sections: [...SECTION_KEYS], status: "active", source: "env" },
    };
  }

  const { data, error } = await supabase
    .from("team_members")
    .select("email, name, role, sections, status")
    .eq("email", e)
    .maybeSingle();

  if (error) {
    // Before the team migration is run there is simply no team: only the allowed-emails list gets in.
    if (isMissingAccessSetup(error)) return { ok: false, reason: "none" };
    return { ok: false, reason: "error", message: error.message };
  }
  if (!data) return { ok: false, reason: "none" };
  if (data.status === "deactivated") return { ok: false, reason: "deactivated" };

  return {
    ok: true,
    access: {
      email: e,
      name: (data.name as string | null) ?? null,
      role: data.role === "manager" ? "manager" : "member",
      sections: parseSections(data.sections),
      status: data.status === "active" ? "active" : "invited",
      source: "team",
    },
  };
}

/** Who is signed in right now, and what may they see. */
export async function getCurrentAccess(supabase: SupabaseClient): Promise<AccessResult> {
  const { data: { user } } = await supabase.auth.getUser();
  return resolveAccess(supabase, user?.email);
}

/**
 * Make sure a founder has a manager row in team_members. The database lock
 * recognises managers by that row, so this runs the first time each founder
 * opens the CRM. `admin` must be the service-role client.
 */
export async function ensureFounderRecord(admin: SupabaseClient, access: Access): Promise<void> {
  if (access.source !== "env") return;
  const { data, error } = await admin.from("team_members").select("id, role, status").eq("email", access.email).maybeSingle();
  if (error) return;                                   // table not created yet: nothing to do
  if (!data) {
    await admin.from("team_members").insert({
      email: access.email,
      name: access.email.split("@")[0].replace(/^./, (c) => c.toUpperCase()),
      role: "manager",
      status: "active",
      first_login_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    });
  } else if (data.role !== "manager" || data.status !== "active") {
    await admin.from("team_members").update({ role: "manager", status: "active" }).eq("id", data.id);
  }
}

/** Called when someone signs in: invited -> active, and stamp the time. */
export async function recordLogin(admin: SupabaseClient, email: string): Promise<void> {
  const now = new Date().toISOString();
  const { data } = await admin.from("team_members").select("id, status, first_login_at").eq("email", normalizeEmail(email)).maybeSingle();
  if (!data || data.status === "deactivated") return;
  await admin
    .from("team_members")
    .update({
      status: "active",
      first_login_at: (data.first_login_at as string | null) ?? now,
      last_login_at: now,
    })
    .eq("id", data.id);
}
