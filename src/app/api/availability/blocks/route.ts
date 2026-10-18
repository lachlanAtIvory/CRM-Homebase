import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { addBlock, loadEditorData } from "@/lib/hq/availability-admin";

/** Add time off (managers only): { person, from, to?, allDay?, fromTime?, toTime?, reason? } */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 }); }

  const admin = adminClient();
  const result = await addBlock(admin, check.access.email, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...(await loadEditorData(admin)) });
}
