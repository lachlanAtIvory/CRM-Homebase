import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * n8n completion callback: POST /api/jobs/:id/complete
 *
 * Same shared-secret header auth as /api/ingest (n8n has no session).
 * Body: { "status": "done" | "failed", "result": { ... } }
 * result.link, if present, renders as an "Open result" button on /agents.
 */
export const runtime = "edge";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const secret = process.env.IVORY_INGEST_KEY;
  if (!secret) {
    return Response.json({ error: "IVORY_INGEST_KEY not configured" }, { status: 500 });
  }
  if (req.headers.get("x-ivory-key") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { status?: string; result?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (body.status !== "done" && body.status !== "failed") {
    return Response.json({ error: `status must be "done" or "failed"` }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { id } = await params;
  const { data: rows, error } = await supabase
    .from("jobs")
    .update({ status: body.status, result: body.result ?? null })
    .eq("id", id)
    .select("id");

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (!rows || rows.length === 0) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  return Response.json({ ok: true, id });
}
