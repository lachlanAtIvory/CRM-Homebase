import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public paths — accessible without auth. Includes analytics endpoints
// because the tracking script + beacon are called from public websites,
// and the Ivory Concierge guest-facing chat + API.
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/track",
  "/track.js",
  "/concierge",
  "/api/concierge",
];

// concierge.agentivory.com (and any preview subdomain that ends in it) is
// the public-facing guest hostname. We let ALL paths through without auth
// AND make it serve ONLY concierge content — CRM admin routes are blocked
// here so curious visitors can't poke at /clients or /applications.
const CONCIERGE_HOST_PATTERN = /(^|\.)concierge\.agentivory\.com$/i;

// Paths that the concierge subdomain is allowed to serve. Anything else
// returns 404 so admin routes (/clients, /applications, etc) don't bleed
// through on that hostname.
const CONCIERGE_ALLOWED = [
  "/",                  // → rewritten by next.config to /concierge/ivory-suites
  "/concierge",         // any /concierge/* path
  "/api/concierge",     // chat + speak APIs
  "/_next",             // bundled JS/CSS
  "/favicon.ico",
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
    // Reject paths that aren't concierge/asset routes. Stops curious
    // visitors from accessing the CRM admin via this hostname.
    const allowed = CONCIERGE_ALLOWED.some(
      (p) => path === p || path.startsWith(`${p}/`),
    );
    if (!allowed) {
      // 404 instead of redirect so it feels like the route doesn't exist
      return new NextResponse("Not found", { status: 404 });
    }
    // Skip auth — guests don't have accounts
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
