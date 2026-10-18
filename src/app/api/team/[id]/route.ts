import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadTeam, removeMember, updateMember } from "@/lib/hq/team-admin";

/**
 * Settings > Team (managers only), one person.
 *   PATCH  { name?, sections?, status?: "active" | "deactivated" }
 *   DELETE removes them from the team entirely.
 * Founders and other managers can't be changed here.
 */
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 }); }

  const { id } = await params;
  const admin = adminClient();
  const result = await updateMember(admin, check.access.email, id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, member: result.member, team: await loadTeam(admin) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const admin = adminClient();
  const result = await removeMember(admin, check.access.email, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, team: await loadTeam(admin) });
}
