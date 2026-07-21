import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  actorFromEmail, fetchMotivationStats, startOfDayAU, type DialResult,
} from "@/lib/hq/motivation-stats";

/**
 * Motivation dashboard — log a dial outcome (or undo the last one).
 *
 * POST { result: "dialed" | "voicemail" | "no_answer", undo?: boolean }
 * Every log is a prospect_events row (type cold_call, detail.source
 * "motivation") attributed to the signed-in actor — the same rows the
 * Phase 4 scoreboard counts. Returns fresh today/week stats.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = actorFromEmail(user.email);

  let body: { result?: string; undo?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const result = body.result as DialResult;
  if (!["dialed", "voicemail", "no_answer", "callback"].includes(result)) {
    return NextResponse.json({ error: `Invalid result: ${body.result}` }, { status: 400 });
  }

  if (body.undo) {
    // Remove this actor's most recent matching log from today (misclicks).
    const { data: last } = await supabase
      .from("prospect_events")
      .select("id")
      .eq("actor", actor)
      .eq("type", "cold_call")
      .eq("detail->>source", "motivation")
      .eq("detail->>result", result)
      .gte("occurred_at", startOfDayAU())
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.id) {
      await supabase.from("prospect_events").delete().eq("id", last.id);
    }
  } else {
    const { error } = await supabase.from("prospect_events").insert({
      type:   "cold_call",
      actor,
      detail: { source: "motivation", result },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const stats = await fetchMotivationStats(supabase, actor);
  return NextResponse.json({ ok: true, stats });
}
