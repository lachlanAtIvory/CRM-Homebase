import { NextRequest } from "next/server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@supabase/supabase-js";
import { buildSystemPrompt } from "@/lib/concierge/prompt";

/**
 * Ivory Concierge chat endpoint.
 *
 * Public-facing — no auth. Whitelisted in middleware. Uses the SERVICE ROLE
 * key for Supabase so RLS doesn't block session/message writes.
 *
 * Edge runtime for low TTFB to the guest.
 */
export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      messages?: UIMessage[];
      hotelSlug?: string;
      sessionId?: string;
      visitorId?: string;
    };

    const { messages, hotelSlug, sessionId, visitorId } = body;

    if (!messages || !hotelSlug || !sessionId) {
      return new Response("Missing required fields", { status: 400 });
    }

    // ── Load hotel context from Supabase ─────────────────────────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: hotel } = await supabase
      .from("concierge_hotels")
      .select("id, slug, name, address, timezone, greeting, is_active")
      .eq("slug", hotelSlug)
      .single();

    if (!hotel || !hotel.is_active) {
      return new Response("Hotel not found", { status: 404 });
    }

    const [{ data: facts }, { data: local }] = await Promise.all([
      supabase
        .from("concierge_facts")
        .select("category, question, answer")
        .eq("hotel_id", hotel.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("concierge_local")
        .select("name, category, distance, hours, description, tags")
        .eq("hotel_id", hotel.id)
        .order("sort_order", { ascending: true }),
    ]);

    // Ensure session exists (idempotent — upserts) and persist the latest user msg.
    // We don't block the response on these — fire and forget so streaming starts fast.
    const country = req.headers.get("x-vercel-ip-country") || null;
    const userAgent = req.headers.get("user-agent")        || null;

    (async () => {
      try {
        await supabase
          .from("concierge_sessions")
          .upsert(
            {
              id:           sessionId,
              hotel_id:     hotel.id,
              visitor_id:   visitorId || null,
              user_agent:   userAgent,
              country,
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );

        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const text = uiMessageToText(lastUser);
          if (text) {
            await supabase.from("concierge_messages").insert({
              session_id: sessionId,
              role:       "user",
              content:    text,
            });
          }
        }
      } catch { /* don't break the chat on logging failures */ }
    })();

    // ── Build the system prompt + call Claude ────────────────────────────────
    const system = buildSystemPrompt({
      hotel: {
        name:     hotel.name as string,
        address:  (hotel.address  as string | null) ?? null,
        timezone: (hotel.timezone as string)      || "Australia/Sydney",
        greeting: (hotel.greeting as string | null) ?? null,
      },
      facts: (facts ?? []) as never,
      local: (local ?? []).map((r) => ({
        ...r,
        tags: Array.isArray(r.tags) ? r.tags as string[] : [],
      })) as never,
    });

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      // Claude Sonnet 4.6 — current best balance of cost + quality for this
      // use case. Switch to "claude-haiku-4-5-20251001" once we hit higher
      // volumes (4x cheaper, still excellent for concierge work).
      model:       anthropic("claude-sonnet-4-6"),
      system,
      messages:    modelMessages,
      temperature: 0.7,
      // Save the assistant message once streaming completes
      onFinish: async ({ text }) => {
        try {
          await supabase.from("concierge_messages").insert({
            session_id: sessionId,
            role:       "assistant",
            content:    text,
          });
        } catch { /* noop */ }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    console.error("Concierge chat error:", e);
    return new Response("Server error", { status: 500 });
  }
}

/** Pull plain text out of a UIMessage (the SDK's parts-based format). */
function uiMessageToText(msg: UIMessage): string {
  if (typeof (msg as unknown as { content?: string }).content === "string") {
    return (msg as unknown as { content: string }).content;
  }
  const parts = (msg as unknown as { parts?: Array<{ type: string; text?: string }> }).parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}
