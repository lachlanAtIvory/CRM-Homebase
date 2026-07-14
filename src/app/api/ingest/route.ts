import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Agent Ivory HQ — single ingest endpoint for all n8n workflows.
 *
 * One consistent contract so every workflow (Retell call_ended, chat widget,
 * mystery-shop logger, cold email events) writes through the same door:
 *
 *   POST /api/ingest
 *   Header: x-ivory-key: <IVORY_INGEST_KEY>
 *   Body:   { table, action?: "insert" | "update", match?, data }
 *
 * Full contract + curl examples per table: docs/ingest.md
 *
 * Auth is the shared-secret header (whitelisted in middleware — no session).
 * Uses the SERVICE ROLE key so RLS doesn't block writes.
 */
export const runtime = "edge";

// Allowlist: which tables n8n may touch, and the minimum fields an insert
// must carry. Column-level validation beyond this is left to Postgres check
// constraints — their error messages come back in the 400 response, which
// is exactly what you want when debugging a workflow.
const ALLOWED_TABLES: Record<string, { required: string[] }> = {
  hq_clients:      { required: ["name"] },
  calls:           { required: ["source"] },
  prospects:       { required: ["business_name"] },
  prospect_events: { required: ["prospect_id", "type"] },
  outreach_events: { required: ["prospect_id", "channel", "event"] },
  jobs:            { required: ["agent"] },
};

type IngestBody = {
  table?:  string;
  action?: "insert" | "update";
  match?:  Record<string, unknown>;
  data?:   Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  // ── Shared-secret auth ────────────────────────────────────────────────────
  const secret = process.env.IVORY_INGEST_KEY;
  if (!secret) {
    return Response.json({ error: "IVORY_INGEST_KEY not configured" }, { status: 500 });
  }
  if (req.headers.get("x-ivory-key") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse + validate ──────────────────────────────────────────────────────
  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const { table, action = "insert", match, data } = body;

  if (!table || !(table in ALLOWED_TABLES)) {
    return Response.json(
      { error: `table must be one of: ${Object.keys(ALLOWED_TABLES).join(", ")}` },
      { status: 400 },
    );
  }
  if (action !== "insert" && action !== "update") {
    return Response.json({ error: `action must be "insert" or "update"` }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
    return Response.json({ error: "data must be a non-empty object" }, { status: 400 });
  }

  if (action === "insert") {
    const missing = ALLOWED_TABLES[table].required.filter(
      (f) => data[f] === undefined || data[f] === null || data[f] === "",
    );
    if (missing.length > 0) {
      return Response.json(
        { error: `missing required fields for ${table}: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  } else {
    // Updates must be targeted — refuse a match-less update rather than
    // letting a misconfigured workflow rewrite a whole table.
    if (!match || typeof match !== "object" || Object.keys(match).length === 0) {
      return Response.json(
        { error: "update requires a non-empty match object" },
        { status: 400 },
      );
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  if (action === "insert") {
    const { data: row, error } = await supabase
      .from(table)
      .insert(data)
      .select("id")
      .single();
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ ok: true, action: "insert", table, id: row.id });
  }

  const { data: rows, error } = await supabase
    .from(table)
    .update(data)
    .match(match!)
    .select("id");
  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({
    ok:      true,
    action:  "update",
    table,
    ids:     (rows ?? []).map((r) => r.id),
    updated: rows?.length ?? 0,
  });
}
