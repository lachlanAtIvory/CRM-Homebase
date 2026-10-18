import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyOutcome, type OutcomeBody } from "@/lib/hq/call-lead-outcome";
import { adminClient } from "@/lib/hq/supabase-admin";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { checkSlotBookable } from "@/lib/hq/availability-data";

/**
 * Call list — log a note or a call outcome against a lead.
 * POST { outcome, note?, when?, with?, contact_name?, email? }
 * The rules live in applyOutcome (src/lib/hq/call-lead-outcome.ts).
 */
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: OutcomeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const check = await requireAccessApi("call-list");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const admin = adminClient();
  const { status, json } = await applyOutcome(supabase, user, id, body, {
    writer: admin,
    checkBookable: (when, person, requireWindow) => checkSlotBookable(admin, when, person, requireWindow),
    strictSlots: check.access.role !== "manager",
  });
  return NextResponse.json(json, { status });
}
