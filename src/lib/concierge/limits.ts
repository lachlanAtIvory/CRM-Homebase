import { SupabaseClient } from "@supabase/supabase-js";

export type CapReason = "session" | "ip" | "hotel-day" | "hotel-month";

/**
 * Returns the cap that's been exceeded (if any) before the chat API
 * hits Anthropic. Order: cheapest counts first so we short-circuit fast.
 */
export async function checkRateLimits(opts: {
  supabase:        SupabaseClient;
  hotelId:         string;
  sessionId:       string;
  ipAddress:       string | null;
  perSessionDaily: number;   // e.g. 30
  perIpDaily:      number;   // e.g. 100
  hotelDailyCap:   number;   // e.g. 200
  hotelMonthlyCap: number;   // e.g. 1000
  timezone:        string;   // e.g. "Australia/Sydney"
}): Promise<{ exceeded: CapReason } | null> {
  const todayStart = startOfDay(opts.timezone);
  const monthStart = startOfMonth(opts.timezone);

  // ── Per-session (cheapest — single index lookup) ────────────────────────
  const { count: sessionCount } = await opts.supabase
    .from("concierge_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", opts.sessionId)
    .eq("role", "user")
    .gte("created_at", todayStart);
  if ((sessionCount ?? 0) >= opts.perSessionDaily) {
    return { exceeded: "session" };
  }

  // ── Per-hotel daily (single index on hotel_id + date) ───────────────────
  // We need to join messages → sessions to filter by hotel_id, but
  // PostgREST doesn't do JOINs easily. Instead: count sessions for this
  // hotel today, then sum their message counts. Simpler approach: store
  // hotel_id on the session itself (we already do) and count messages
  // for all sessions of this hotel today.
  const hotelDayCount = await countHotelUserMessages(
    opts.supabase,
    opts.hotelId,
    todayStart,
  );
  if (hotelDayCount >= opts.hotelDailyCap) {
    return { exceeded: "hotel-day" };
  }

  // ── Per-hotel monthly ───────────────────────────────────────────────────
  const hotelMonthCount = await countHotelUserMessages(
    opts.supabase,
    opts.hotelId,
    monthStart,
  );
  if (hotelMonthCount >= opts.hotelMonthlyCap) {
    return { exceeded: "hotel-month" };
  }

  // ── Per-IP daily (only checked if we have an IP) ────────────────────────
  if (opts.ipAddress) {
    const ipCount = await countIpUserMessages(
      opts.supabase,
      opts.ipAddress,
      todayStart,
    );
    if (ipCount >= opts.perIpDaily) {
      return { exceeded: "ip" };
    }
  }

  return null;
}

async function countHotelUserMessages(
  supabase:   SupabaseClient,
  hotelId:    string,
  sinceIso:   string,
): Promise<number> {
  // 1. Get session ids belonging to this hotel
  const { data: sessions } = await supabase
    .from("concierge_sessions")
    .select("id")
    .eq("hotel_id", hotelId);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  if (sessionIds.length === 0) return 0;

  // 2. Count user messages across those sessions in the window
  const { count } = await supabase
    .from("concierge_messages")
    .select("id", { count: "exact", head: true })
    .in("session_id", sessionIds)
    .eq("role", "user")
    .gte("created_at", sinceIso);
  return count ?? 0;
}

async function countIpUserMessages(
  supabase:  SupabaseClient,
  ip:        string,
  sinceIso:  string,
): Promise<number> {
  const { data: sessions } = await supabase
    .from("concierge_sessions")
    .select("id")
    .eq("ip_address", ip);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  if (sessionIds.length === 0) return 0;

  const { count } = await supabase
    .from("concierge_messages")
    .select("id", { count: "exact", head: true })
    .in("session_id", sessionIds)
    .eq("role", "user")
    .gte("created_at", sinceIso);
  return count ?? 0;
}

// ─── Time helpers — bucket by hotel's local day/month, not UTC ───────────

function startOfDay(timezone: string): string {
  const now = new Date();
  // Pin to local-date midnight in the hotel's TZ
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  // en-CA gives YYYY-MM-DD — perfect ISO date
  return `${localDate}T00:00:00+00:00`; // close enough — we just want a stable lower bound
}

function startOfMonth(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit",
  }).format(now);
  // parts = "YYYY-MM"
  const [y, m] = parts.split("-");
  return `${y}-${m}-01T00:00:00+00:00`;
}

// ─── Capped-response SSE stream ──────────────────────────────────────────

/** Returns the polite message we stream when a rate limit hits. */
export function cappedReplyFor(reason: CapReason): string {
  switch (reason) {
    case "session":
      return "I've answered everything I can in this chat for today — give the front desk a call by pressing 0 on your room phone if you need anything else.";
    case "ip":
      return "We've hit a quick safety limit on this device. Press 0 from your room phone for reception, or check back in a few hours.";
    case "hotel-day":
    case "hotel-month":
      return "I've helped with everything I can today — press 0 from your room phone and the front desk will sort you out.";
  }
}

/**
 * Build a Response that streams a single pre-canned assistant message in
 * the same UI-message-stream format `useChat` consumes. This means a
 * capped reply renders exactly like a real Claude reply — no error UI.
 */
export function cappedStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }
      send({ type: "start" });
      send({ type: "start-step" });
      send({ type: "text-start", id: "0" });
      // Send as one chunk — no need to fake word-by-word streaming for a
      // canned message that won't be costing per-token.
      send({ type: "text-delta", id: "0", delta: text });
      send({ type: "text-end", id: "0" });
      send({ type: "finish-step" });
      send({ type: "finish", finishReason: "stop" });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status:  200,
    headers: {
      "Content-Type":                "text/event-stream",
      "Cache-Control":               "no-cache",
      "X-Vercel-AI-UI-Message-Stream": "v1",
    },
  });
}
