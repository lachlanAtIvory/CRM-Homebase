import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { buildGuruSystem } from "@/lib/hq/guru-prompt";
import { GURU_ENABLED } from "@/lib/hq/guru-flags";

/**
 * The Guru — sales-trainer chat.
 *
 * Session-authed. Calls Claude server-side with the Guru persona + the
 * full Sales Bible as system prompt (ported from the standalone guru
 * HTML tool, which called Anthropic from the browser with an embedded
 * key — now retired).
 *
 * The system block is wrapped in Anthropic prompt caching: the ~14k-token
 * bible is billed at 10% on every turn within the cache window, so a
 * training session costs cents, not dollars.
 */
export const maxDuration = 60;

type GuruBody = {
  message?: string;
  history?: { role: "user" | "guru"; text: string }[];
};

export async function POST(req: NextRequest) {
  // Kill switch — while disabled, no request can reach Anthropic.
  if (!GURU_ENABLED) {
    return NextResponse.json(
      { error: "The Guru is paused for now. The Sales Bible is in the sidebar — the playbook never sleeps." },
      { status: 503 },
    );
  }

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

  const history = (body.history ?? []).slice(-12).map((m) => ({
    role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
    content: m.text,
  }));

  try {
    const result = await generateText({
      // Same model the standalone guru ran on — swap to a newer Sonnet
      // deliberately (and re-test the voice) rather than by accident.
      model: anthropic("claude-sonnet-4-6"),
      messages: [
        {
          role:    "system",
          content: buildGuruSystem(),
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        ...history,
        { role: "user", content: message },
      ],
      maxOutputTokens: 1500,
    });

    return NextResponse.json({ reply: result.text });
  } catch (e) {
    console.error("Guru error:", e);
    return NextResponse.json(
      { error: "Hit a snag talking to the brain. Say it again and we go again." },
      { status: 502 },
    );
  }
}
