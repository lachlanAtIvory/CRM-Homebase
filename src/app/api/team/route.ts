import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { addMember, loadTeam } from "@/lib/hq/team-admin";

/**
 * Settings > Team (managers only).
 *   GET  -> the team, who's a founder, the change log, and whether the database lock is on.
 *   POST -> add someone by email BEFORE they've ever signed in: { email, name?, preset?, sections? }
 */
export const runtime = "nodejs";

export async function GET() {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  return NextResponse.json(await loadTeam(adminClient()));
}

export async function POST(req: NextRequest) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 }); }

  const admin = adminClient();
  const result = await addMember(admin, check.access.email, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, member: result.member, team: await loadTeam(admin) });
}
