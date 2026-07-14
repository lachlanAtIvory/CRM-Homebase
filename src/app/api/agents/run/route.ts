import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/hq/agents-config";

/**
 * HQ Mission Control — fire an agent.
 *
 * Session-authed (internal page). Creates a `jobs` row (queued), POSTs the
 * form data + job_id to the agent's n8n webhook with the shared secret
 * header, then marks the job running. n8n reports back later via
 * POST /api/jobs/:id/complete.
 *
 * If the webhook env var is missing or the POST fails, the job is marked
 * failed immediately with the reason in result.error — the UI shows it.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { agent?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const config = AGENTS.find((a) => a.id === body.agent);
  if (!config) {
    return NextResponse.json({ error: `Unknown agent: ${body.agent}` }, { status: 400 });
  }
  const input = body.data ?? {};

  const missing = config.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = input[f.key];
      return v === undefined || v === null || v === "";
    })
    .map((f) => f.key);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  // Queue the job (cookie-authed client — RLS "auth full access" applies)
  const { data: job, error: insertError } = await supabase
    .from("jobs")
    .insert({
      agent:      config.id,
      status:     "queued",
      input,
      created_by: user.email ?? user.id,
    })
    .select("id")
    .single();
  if (insertError || !job) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create job" },
      { status: 500 },
    );
  }

  const fail = async (reason: string) => {
    await supabase
      .from("jobs")
      .update({ status: "failed", result: { error: reason } })
      .eq("id", job.id);
    return NextResponse.json({ id: job.id, status: "failed", error: reason });
  };

  const webhookUrl = process.env[config.webhookEnv];
  if (!webhookUrl) {
    return fail(`Webhook not configured — set ${config.webhookEnv} in Vercel.`);
  }

  // Fire the webhook. 10s cap so a dead n8n doesn't hang the function.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(webhookUrl, {
      method:  "POST",
      headers: {
        "content-type": "application/json",
        "x-ivory-key":  process.env.IVORY_INGEST_KEY ?? "",
      },
      body:   JSON.stringify({ job_id: job.id, agent: config.id, ...input }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return fail(`Webhook responded ${res.status}`);
    }
  } catch {
    return fail("Webhook unreachable (timeout or network error)");
  }

  await supabase.from("jobs").update({ status: "running" }).eq("id", job.id);
  return NextResponse.json({ id: job.id, status: "running" });
}
