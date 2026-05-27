import { NextRequest } from "next/server";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@supabase/supabase-js";
import { buildSystemPrompt } from "@/lib/concierge/prompt";
import { fetchWeatherBlurb } from "@/lib/concierge/weather";
import { checkRateLimits, cappedReplyFor, cappedStreamResponse } from "@/lib/concierge/limits";

/**
 * Ivory Concierge chat endpoint.
 *
 * Public-facing — no auth. Whitelisted in middleware. Uses the SERVICE ROLE
 * key for Supabase so RLS doesn't block session/message writes.
 *
 * Edge runtime for low TTFB to the guest.
 */
export const runtime = "edge";

// ── Rate limit defaults (per-hotel caps live on the concierge_hotels row) ──
const SESSION_DAILY_CAP = 30;   // single browser tab
const IP_DAILY_CAP      = 100;  // single network / mobile carrier
const HISTORY_CAP       = 20;   // keep last 10 user/assistant pairs

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
      .select("id, slug, name, address, timezone, greeting, is_active, lat, lng, daily_conv_cap, monthly_conv_cap")
      .eq("slug", hotelSlug)
      .single();

    if (!hotel || !hotel.is_active) {
      return new Response("Hotel not found", { status: 404 });
    }

    const timezone     = (hotel.timezone as string) || "Australia/Sydney";
    const ipAddress    = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
                         || req.headers.get("x-real-ip")
                         || null;

    // ── Rate-limit pre-flight (BEFORE we hit Anthropic) ─────────────────────
    // Order: session (cheapest lookup) → hotel daily → hotel monthly → ip.
    // If any cap is hit, stream back a polite canned reply for FREE.
    const rateLimitHit = await checkRateLimits({
      supabase,
      hotelId:         hotel.id as string,
      sessionId,
      ipAddress,
      perSessionDaily: SESSION_DAILY_CAP,
      perIpDaily:      IP_DAILY_CAP,
      hotelDailyCap:   (hotel.daily_conv_cap   as number) || 200,
      hotelMonthlyCap: (hotel.monthly_conv_cap as number) || 1000,
      timezone,
    });
    if (rateLimitHit) {
      // Log the user's question + the canned reply so they show up in the
      // CRM transcript and the cap reason is visible to the admin.
      const text = cappedReplyFor(rateLimitHit.exceeded);
      const lastUser = messages.length > 0 ? uiMessageToText(messages[messages.length - 1]) : "";
      (async () => {
        try {
          if (lastUser) {
            await supabase.from("concierge_messages").insert([
              { session_id: sessionId, role: "user",      content: lastUser },
              { session_id: sessionId, role: "assistant", content: `[rate-limited:${rateLimitHit.exceeded}] ${text}` },
            ]);
          }
        } catch { /* noop */ }
      })();
      return cappedStreamResponse(text);
    }

    // Pull facts + local recs + live weather in parallel
    const lat = hotel.lat as number | null;
    const lng = hotel.lng as number | null;

    const [{ data: facts }, { data: local }, weather] = await Promise.all([
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
      lat !== null && lng !== null ? fetchWeatherBlurb(lat, lng, timezone) : Promise.resolve(null),
    ]);

    // Upsert session + persist the latest user msg (fire and forget so streaming starts fast)
    const country   = req.headers.get("x-vercel-ip-country") || null;
    const userAgent = req.headers.get("user-agent")          || null;

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
              ip_address:   ipAddress,
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
        timezone,
        greeting: (hotel.greeting as string | null) ?? null,
      },
      facts: (facts ?? []) as never,
      local: (local ?? []).map((r) => ({
        ...r,
        tags: Array.isArray(r.tags) ? r.tags as string[] : [],
      })) as never,
      weather,
    });

    const modelMessages = await convertToModelMessages(messages);

    // Cap history so long sessions don't balloon input-token cost.
    const capped = modelMessages.length > HISTORY_CAP
      ? modelMessages.slice(-HISTORY_CAP)
      : modelMessages;

    const result = streamText({
      // Haiku 4.5 — 4x cheaper than Sonnet, excellent for concierge work
      // (short answers, follow facts, no complex reasoning needed).
      model:       anthropic("claude-haiku-4-5-20251001"),
      messages: [
        // System message wrapped with Anthropic prompt caching so the
        // 3000-token block of hotel facts + local recs + weather is
        // billed at 10% on every reply within 5 min. Major cost win.
        {
          role:    "system",
          content: system,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        ...capped,
      ],
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
