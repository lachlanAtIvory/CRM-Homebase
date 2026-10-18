import type { SupabaseClient } from "@supabase/supabase-js";
import { getAllowedEmails } from "@/lib/auth";
import {
  DEFAULT_PRESET, isMissingAccessSetup, isValidEmail, normalizeEmail, parseSections, PRESETS,
  type SectionKey,
} from "./access";

/**
 * Settings > Team — adding people, changing what they can see, switching
 * them off. Every function takes the service-role client and is only ever
 * called after the route has confirmed the caller is a manager.
 *
 * Rules:
 *   - Ryan and Lachlan (the ALLOWED_EMAILS list) can't be edited or removed here.
 *   - Manager rows can't be edited here either, only members.
 *   - Every change is written to the audit log.
 */

export type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  role: "manager" | "member";
  sections: SectionKey[];
  status: "invited" | "active" | "deactivated";
  invited_by: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  target_email: string | null;
  detail: Record<string, unknown>;
  at: string;
};

export type Founder = { email: string; name: string; last_login_at: string | null };

export type TeamOverview = {
  founders: Founder[];
  members: TeamMember[];
  audit: AuditEntry[];
  /** null = couldn't tell; true = the database lock migration has been run. */
  hardened: boolean | null;
  /** True when the first team migration hasn't been run yet. */
  setupNeeded: boolean;
};

type Failure = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Failure => ({ ok: false, status, error });

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const isFounder = (email: string) => getAllowedEmails().includes(email);

const rowToMember = (r: Record<string, unknown>): TeamMember => ({
  id: r.id as string,
  email: r.email as string,
  name: (r.name as string | null) ?? null,
  role: r.role === "manager" ? "manager" : "member",
  sections: parseSections(r.sections),
  status: (r.status as TeamMember["status"]) ?? "invited",
  invited_by: (r.invited_by as string | null) ?? null,
  first_login_at: (r.first_login_at as string | null) ?? null,
  last_login_at: (r.last_login_at as string | null) ?? null,
  created_at: r.created_at as string,
});

async function audit(
  admin: SupabaseClient, actor: string, action: string, target: string | null, detail: Record<string, unknown> = {},
) {
  await admin.from("team_audit").insert({ actor, action, target_email: target, detail });
}

/* ── Read ────────────────────────────────────────────────────────────────── */

export async function loadTeam(admin: SupabaseClient): Promise<TeamOverview> {
  const { data, error } = await admin.from("team_members").select("*").order("created_at", { ascending: true });
  if (error) {
    return { founders: founderList([]), members: [], audit: [], hardened: null, setupNeeded: isMissingAccessSetup(error) };
  }
  const rows = (data ?? []).map(rowToMember);
  const { data: auditRows } = await admin.from("team_audit").select("*").order("at", { ascending: false }).limit(20);
  const { data: hardened, error: rpcError } = await admin.rpc("rls_hardened");

  return {
    founders: founderList(rows),
    members: rows.filter((m) => m.role === "member" && !isFounder(m.email)),
    audit: (auditRows ?? []) as AuditEntry[],
    hardened: rpcError ? null : hardened === true,
    setupNeeded: false,
  };
}

function founderList(rows: TeamMember[]): Founder[] {
  return getAllowedEmails().map((email) => {
    const row = rows.find((r) => r.email === email);
    return {
      email,
      name: row?.name ?? titleCase(email.split("@")[0]),
      last_login_at: row?.last_login_at ?? null,
    };
  });
}

/* ── Add ─────────────────────────────────────────────────────────────────── */

export async function addMember(
  admin: SupabaseClient,
  actorEmail: string,
  input: { email?: unknown; name?: unknown; sections?: unknown; preset?: unknown },
): Promise<{ ok: true; member: TeamMember } | Failure> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return fail(400, "Enter a valid email address.");
  if (isFounder(email)) return fail(409, "That's one of the founders. They already have full access.");

  const name = String(input.name ?? "").trim().slice(0, 80) || null;
  const preset = PRESETS.find((p) => p.key === input.preset) ?? PRESETS.find((p) => p.key === DEFAULT_PRESET)!;
  const sections = Array.isArray(input.sections) ? parseSections(input.sections) : preset.sections;

  const { data, error } = await admin
    .from("team_members")
    .insert({ email, name, role: "member", sections, status: "invited", invited_by: actorEmail })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return fail(409, "That email is already on the team.");
    if (isMissingAccessSetup(error)) return fail(503, "Run the team access migration in Supabase first (see the banner at the top).");
    return fail(500, error.message);
  }
  await audit(admin, actorEmail, "added member", email, { sections });
  return { ok: true, member: rowToMember(data) };
}

/* ── Change ──────────────────────────────────────────────────────────────── */

async function findEditable(admin: SupabaseClient, id: string): Promise<{ row: TeamMember } | Failure> {
  const { data, error } = await admin.from("team_members").select("*").eq("id", id).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "That person isn't on the team any more.");
  const row = rowToMember(data);
  if (row.role === "manager" || isFounder(row.email)) return fail(403, "Managers can't be changed here.");
  return { row };
}

export async function updateMember(
  admin: SupabaseClient,
  actorEmail: string,
  id: string,
  changes: { name?: unknown; sections?: unknown; status?: unknown },
): Promise<{ ok: true; member: TeamMember } | Failure> {
  const found = await findEditable(admin, id);
  if ("ok" in found) return found;
  const { row } = found;

  const patch: Record<string, unknown> = {};
  const detail: Record<string, unknown> = {};
  let action = "updated member";

  if (changes.name !== undefined) patch.name = String(changes.name ?? "").trim().slice(0, 80) || null;

  if (changes.sections !== undefined) {
    const next = parseSections(changes.sections);
    patch.sections = next;
    detail.added = next.filter((s) => !row.sections.includes(s));
    detail.removed = row.sections.filter((s) => !next.includes(s));
    action = "changed access";
  }

  if (changes.status !== undefined) {
    if (changes.status === "deactivated") {
      patch.status = "deactivated";
      action = "deactivated";
    } else if (changes.status === "active") {
      // Switching someone back on: if they've never signed in they're still just invited.
      patch.status = row.first_login_at ? "active" : "invited";
      action = "reactivated";
    } else {
      return fail(400, "Unknown status.");
    }
  }

  if (!Object.keys(patch).length) return { ok: true, member: row };
  const { data, error } = await admin.from("team_members").update(patch).eq("id", id).select("*").single();
  if (error) return fail(500, error.message);
  await audit(admin, actorEmail, action, row.email, detail);
  return { ok: true, member: rowToMember(data) };
}

/* ── Remove ──────────────────────────────────────────────────────────────── */

export async function removeMember(
  admin: SupabaseClient, actorEmail: string, id: string,
): Promise<{ ok: true } | Failure> {
  const found = await findEditable(admin, id);
  if ("ok" in found) return found;
  const { error } = await admin.from("team_members").delete().eq("id", id);
  if (error) return fail(500, error.message);
  await audit(admin, actorEmail, "removed member", found.row.email);
  return { ok: true };
}
