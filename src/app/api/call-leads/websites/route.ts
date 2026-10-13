import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillMissingWebsites } from "@/lib/hq/call-lead-admin";

/**
 * Call list — fill in missing websites on leads already in the list, by
 * matching each lead's email domain (or another link column) to its
 * business name. Re-importing a sheet never touches existing leads, so this
 * is how already-imported leads get the same treatment new ones do.
 *
 * POST { dryRun?: boolean }  (dryRun is the default; pass false to apply)
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { dryRun?: unknown } = {};
  try { body = await req.json(); } catch { /* an empty body means a dry run */ }

  const dryRun = body.dryRun !== false;
  const result = await fillMissingWebsites(supabase, dryRun);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, dryRun, ...result });
}
