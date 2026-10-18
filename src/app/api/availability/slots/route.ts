import { NextRequest, NextResponse } from "next/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import { getSlots } from "@/lib/hq/availability-data";

/**
 * Call list — the times a sales call can be booked, for the booking buttons.
 *
 * GET /api/availability/slots?days=14
 * A time is offered for a person only if it's inside their weekly hours, they
 * haven't blocked it out, and nothing on the shared calendar overlaps it.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const check = await requireAccessApi("call-list");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const days = Number(req.nextUrl.searchParams.get("days")) || undefined;
  const result = await getSlots(adminClient(), days);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
