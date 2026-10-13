import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyOutcome, type OutcomeBody } from "@/lib/hq/call-lead-outcome";

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

  const { id } = await params;
  const { status, json } = await applyOutcome(supabase, user, id, body);
  return NextResponse.json(json, { status });
}
