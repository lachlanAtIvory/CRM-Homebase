import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadEditorData, saveHours } from "@/lib/hq/availability-admin";

/**
 * Settings > Call availability (managers only).
 *   GET -> weekly hours for Ryan and Lachlan, and upcoming time off.
 *   PUT -> replace one person's weekly hours: { person, days: [{ weekday, enabled, start, end }] }
 */
export const runtime = "nodejs";

export async function GET() {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  return NextResponse.json(await loadEditorData(adminClient()));
}

export async function PUT(req: NextRequest) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: { person?: unknown; days?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 }); }

  const admin = adminClient();
  const result = await saveHours(admin, body.person, body.days);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...(await loadEditorData(admin)) });
}
