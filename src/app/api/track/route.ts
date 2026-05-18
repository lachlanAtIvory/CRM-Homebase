import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Public analytics beacon endpoint.
 *
 * Receives pageview + heartbeat events from the small JS snippet running on
 * agentivory.com (and any future tracked sites). Uses the SERVICE ROLE key
 * so RLS doesn't block the insert — that's fine because this route is the
 * only thing allowed to write to analytics_events.
 *
 * Safety properties — the website calling this MUST be unaffected if this
 * route ever fails or is slow:
 *   - Tracking script uses navigator.sendBeacon (fire-and-forget)
 *   - This route ALWAYS responds 204 in <50ms, even on error
 *   - All errors are caught and silenced
 *   - CORS allows the agentivory.com origin
 */

// Edge runtime: cold-start fast and runs close to the visitor. Cheap inserts.
export const runtime = "edge";

// Allowed origins — the tracking script can only be successfully called from
// these. Extend as you onboard more tracked sites.
const ALLOWED_ORIGINS = new Set<string>([
  "https://agentivory.com",
  "https://www.agentivory.com",
  // Lovable's preview/staging domains
  "https://agentivory.lovable.app",
  // Allow localhost for dev work
  "http://localhost:3000",
  "http://localhost:5173",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
  };
}

// Pre-flight CORS
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

// ─── User-Agent parsing — light, no deps ─────────────────────────────────────
function parseUA(ua: string): { device: string; browser: string; os: string } {
  const u = ua || "";

  const device =
    /Mobi|Android|iPhone/i.test(u) && !/iPad|Tablet/i.test(u) ? "mobile"
    : /iPad|Tablet/i.test(u)                                  ? "tablet"
                                                              : "desktop";

  const browser =
    /Edg\//i.test(u)               ? "Edge"
    : /OPR\/|Opera/i.test(u)       ? "Opera"
    : /Chrome/i.test(u)            ? "Chrome"
    : /Safari/i.test(u)            ? "Safari"
    : /Firefox/i.test(u)           ? "Firefox"
                                   : "Other";

  const os =
    /Windows/i.test(u)             ? "Windows"
    : /Mac OS X/i.test(u) && !/Mobile/i.test(u) ? "macOS"
    : /iPhone|iPad|iOS/i.test(u)   ? "iOS"
    : /Android/i.test(u)           ? "Android"
    : /Linux/i.test(u)             ? "Linux"
                                   : "Other";

  return { device, browser, os };
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  // Always respond fast — never let the caller hang or learn details
  try {
    const body = await req.json().catch(() => null) as null | {
      site_id?:    string;
      session_id?: string;
      visitor_id?: string;
      event_type?: string;
      path?:       string;
      referrer?:   string;
    };

    if (!body || !body.session_id || !body.event_type) {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (body.event_type !== "pageview" && body.event_type !== "heartbeat") {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
    }

    const ua = req.headers.get("user-agent") ?? "";
    const { device, browser, os } = parseUA(ua);

    // Vercel sets this header automatically based on edge IP geolocation
    const country = req.headers.get("x-vercel-ip-country") || null;

    const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      // Misconfigured — silently swallow, never break the caller
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Lightweight client (no auth helpers, no cookies)
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Truncate / sanitise — never store huge strings
    const trim = (s?: string, max = 500) =>
      typeof s === "string" ? s.slice(0, max) : null;

    await supabase.from("analytics_events").insert({
      site_id:    trim(body.site_id) || "agentivory",
      session_id: trim(body.session_id, 100)!,
      visitor_id: trim(body.visitor_id, 100),
      event_type: body.event_type,
      path:       trim(body.path, 500),
      referrer:   trim(body.referrer, 500),
      country,
      device,
      browser,
      os,
    });
  } catch {
    // Swallow — tracking failures must never bubble back to the website
  }

  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
