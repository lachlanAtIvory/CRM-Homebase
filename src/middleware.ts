import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public paths — accessible without auth. Includes analytics endpoints
// because the tracking script + beacon are called from public websites,
// the Ivory Concierge guest-facing chat + API, and the HQ ingest endpoint
// (called by n8n; guarded by the x-ivory-key shared secret, not a session).
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/track",
  "/track.js",
  "/concierge",
  "/api/concierge",
  "/api/ingest",
  // /api/jobs/:id/complete is the n8n callback (x-ivory-key header auth).
  // The sibling GET /api/jobs/:id does its own session check in-route.
  "/api/jobs",
];

// concierge.agentivory.com (and any preview subdomain that ends in it) is
// the public-facing guest hostname. We let ALL paths through without auth
// AND make it serve ONLY concierge content — CRM admin routes are blocked
// here so curious visitors can't poke at /clients or /applications.
const CONCIERGE_HOST_PATTERN = /(^|\.)concierge\.agentivory\.com$/i;

// Paths that CRM admin uses — these are explicitly blocked on the public
// concierge hostname so visitors can't poke admin pages. Everything else
// is allowed through (which is necessary because next.config rewrites
// /:slug → /concierge/:slug AFTER middleware runs).
const CONCIERGE_BLOCKED = [
  "/clients",
  "/applications",
  "/application",       // covers /application/new + /application/[id]
  "/pipeline",
  "/analytics",
  "/agents",
  "/calendar",
  "/settings",
  "/tasks",
  "/concierge-usage",
  "/login",
  "/auth",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session token. Must come before any routing logic.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const host = request.headers.get("host") ?? "";

  // ── concierge.agentivory.com — public guest experience only ────────────────
  if (CONCIERGE_HOST_PATTERN.test(host)) {
    // Block CRM admin paths so they don't bleed through on this hostname.
    // We use a blocklist (not allowlist) because next.config rewrites
    // /:slug → /concierge/:slug AFTER middleware — at this point we can't
    // tell `/ivory-suites` (valid hotel slug) from a CRM route.
    const blocked = CONCIERGE_BLOCKED.some(
      (p) => path === p || path.startsWith(`${p}/`),
    );
    if (blocked) {
      // 404 instead of redirect so it feels like the route doesn't exist
      return new NextResponse("Not found", { status: 404 });
    }
    // Skip auth — guests don't have accounts; let rewrite + page routing
    // handle invalid slugs naturally (notFound() in the page → 404)
    return response;
  }

  // ── Default (CRM) — auth required except for whitelisted public paths ────
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
