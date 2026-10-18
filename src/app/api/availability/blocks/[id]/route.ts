import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadEditorData, removeBlock } from "@/lib/hq/availability-admin";

/** Remove a piece of time off (managers only). */
export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAccessApi("manager");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const admin = adminClient();
  const result = await removeBlock(admin, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ...(await loadEditorData(admin)) });
}
