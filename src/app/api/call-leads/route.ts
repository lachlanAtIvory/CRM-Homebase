import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchCallLeads, fetchTabCounts, isMissingTable, type Tab } from "@/lib/hq/call-leads";

/**
 * Call list — one page of leads for a tab (or a search across all tabs),
 * plus the three tab counts. Session-authed.
 *
 * GET /api/call-leads?tab=todo|callbacks|done&q=breeze
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const tabParam = params.get("tab");
  const tab: Tab = tabParam === "callbacks" || tabParam === "done" ? tabParam : "todo";

  const [result, counts] = await Promise.all([
    fetchCallLeads(supabase, { tab, q: params.get("q") ?? "" }),
    fetchTabCounts(supabase),
  ]);
  if (result.error) {
    const status = isMissingTable(result.error) ? 503 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ leads: result.leads, total: result.total, counts });
}
