import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { PURGE_SCOPES, previewPurge, runPurge, type PurgeScope } from "@/lib/hq/call-lead-admin";

/**
 * Call list — delete leads in bulk.
 *
 * POST { scope: "untouched" | "finished" | "all", dryRun?: boolean }
 *   dryRun (the default) only counts; pass dryRun: false to delete.
 *
 * TODO(roles): manager-only once roles ship.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  { const check = await requireAccessApi("manager"); if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status }); }

  let body: { scope?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (!PURGE_SCOPES.includes(body.scope as PurgeScope)) {
    return NextResponse.json({ error: "Choose which leads to delete." }, { status: 400 });
  }
  const scope = body.scope as PurgeScope;

  if (body.dryRun !== false) {
    const summary = await previewPurge(supabase, scope);
    if ("error" in summary) return NextResponse.json({ error: summary.error }, { status: summary.status });
    return NextResponse.json({ ok: true, dryRun: true, scope, ...summary });
  }

  const result = await runPurge(supabase, scope);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, dryRun: false, scope, ...result });
}
