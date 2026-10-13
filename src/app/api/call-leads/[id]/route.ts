import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteLead } from "@/lib/hq/call-lead-admin";

/**
 * Call list — delete one lead. Its notes and call history go with it; a
 * client, deal or calendar event created by a booking is left alone.
 * TODO(roles): manager-only once roles ship.
 */
export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await deleteLead(supabase, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, counts: result.counts });
}
