import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { landingPath, parseSections, PREVIEW_COOKIE, type Access } from "@/lib/hq/access";

/**
 * Preview as a team member (managers only).
 *   POST   { id }  start previewing as that member; answers with where to go first
 *   DELETE         stop previewing
 *
 * It only changes what the manager SEES. They're still signed in as themselves, so anything
 * they do while previewing is real and done as them.
 */
export const runtime = "nodejs";

const EIGHT_HOURS = 8 * 60 * 60;

export async function POST(req: NextRequest) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 }); }
  const id = String(body.id ?? "");

  const { data } = await adminClient()
    .from("team_members")
    .select("id, email, name, role, sections, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.role !== "member") return NextResponse.json({ error: "That person isn't on the team." }, { status: 404 });
  if (data.status === "deactivated") return NextResponse.json({ error: "They're switched off, so there's nothing to preview. Switch them back on first." }, { status: 409 });

  const member: Access = {
    email: data.email as string, name: (data.name as string | null) ?? null, role: "member",
    sections: parseSections(data.sections), status: "active", source: "team",
  };

  const res = NextResponse.json({ ok: true, landing: landingPath(member) });
  res.cookies.set(PREVIEW_COOKIE, data.id as string, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: EIGHT_HOURS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}
