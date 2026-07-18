import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The Guru — chat proxy to the n8n guru engine.
 *
 * Session-authed (internal widget). Forwards { message, history } to the
 * webhook in N8N_WEBHOOK_GURU with the shared-secret header and returns
 * { reply }. Tolerant of the common n8n response shapes ({ output },
 * { reply }, { text }, { message }, [{ output }], or raw text).
 *
 * AI agents in n8n can take a while — allow up to 60s.
 */
export const maxDuration = 60;

type GuruBody = {
  message?: string;
  history?: { role: "user" | "guru"; text: string }[];
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GuruBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const webhookUrl = process.env.N8N_WEBHOOK_GURU;
  if (!webhookUrl) {
    return NextResponse.json({
      reply: "The Guru engine isn't connected yet — add the N8N_WEBHOOK_GURU env var in Vercel and redeploy, then I'll come alive.",
    });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    const res = await fetch(webhookUrl, {
      method:  "POST",
      headers: {
        "content-type": "application/json",
        "x-ivory-key":  process.env.IVORY_INGEST_KEY ?? "",
      },
      body: JSON.stringify({
        message,
        history: (body.history ?? []).slice(-12),
        user:    user.email ?? user.id,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json(
        { error: `The Guru engine responded ${res.status} — check the n8n execution log.` },
        { status: 502 },
      );
    }

    const raw = await res.text();
    return NextResponse.json({ reply: extractReply(raw) });
  } catch {
    return NextResponse.json(
      { error: "The Guru took too long or was unreachable — check n8n is running." },
      { status: 504 },
    );
  }
}

/** Pull the reply text out of whatever shape the n8n workflow returns. */
function extractReply(raw: string): string {
  try {
    const j: unknown = JSON.parse(raw);
    const first = Array.isArray(j) ? j[0] : j;
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const o = first as Record<string, unknown>;
      for (const key of ["output", "reply", "text", "message", "answer"]) {
        if (typeof o[key] === "string" && (o[key] as string).trim()) return o[key] as string;
      }
    }
  } catch { /* not JSON — fall through to raw text */ }
  return raw.trim() || "…the Guru went quiet. Check the n8n workflow's response node.";
}
