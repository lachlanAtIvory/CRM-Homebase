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

export type AccessView = {
  /** Who is really signed in. Used for who may do what behind the scenes. */
  real: Access;
  /** What they get to SEE. Equal to `real`, unless a manager is previewing someone. */
  effective: Access;
  /** Set while a manager is previewing as a team member. */
  previewing: { id: string; name: string | null; email: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Like resolveAccess, plus "preview as": a manager can look at the CRM exactly as a
 * team member sees it. A preview only ever NARROWS what a manager sees, and it's ignored
 * for anyone who isn't really a manager, so it can't be used to see more.
 * An unusable preview (person removed, switched off, or not a plain member) is ignored.
 */
export async function resolveAccessView(
  supabase: SupabaseClient,
  email: string | null | undefined,
  previewId?: string | null,
): Promise<{ ok: true; view: AccessView } | Extract<AccessResult, { ok: false }>> {
  const r = await resolveAccess(supabase, email);
  if (!r.ok) return r;
  const plain = { ok: true as const, view: { real: r.access, effective: r.access, previewing: null } };
  if (!previewId || r.access.role !== "manager" || !UUID.test(previewId)) return plain;

  const { data } = await supabase
    .from("team_members")
    .select("id, email, name, role, sections, status")
    .eq("id", previewId)
    .maybeSingle();
  if (!data || data.role !== "member" || data.status === "deactivated") return plain;

  const effective: Access = {
    email: data.email as string,
    name: (data.name as string | null) ?? null,
    role: "member",
    sections: parseSections(data.sections),
    status: "active",
    source: "team",
  };
  return {
    ok: true,
    view: { real: r.access, effective, previewing: { id: data.id as string, name: effective.name, email: effective.email } },
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
