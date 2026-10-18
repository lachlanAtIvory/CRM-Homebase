import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { can, landingPath, routeNeed } from "@/lib/hq/access";
import { resolveAccess } from "@/lib/hq/access-server";

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
  // Client portal — the unguessable portal_token IS the access control,
  // not a session (see src/app/client/[token]/page.tsx).
  "/client",
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
  "/quote",
  "/sales-bible",
  "/motivation",
  "/hq",                // static internal tools (quote calculator etc.)
  "/calendar",
  "/settings",
  "/tasks",
  "/concierge-usage",
  "/client-portals",    // internal management page — NOT the /client/[token] portal itself
  "/call-list",         // scraped lead data + caller notes
  "/api/call-leads",    // this host skips session checks, so wall it off entirely
  "/api/invoices",      // financial data; this host skips session checks, so wall it off entirely
  "/client",            // the client-report portal is a separate product surface, not for this host
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

  // ── Signed in: are they on the team, and is this somewhere they may go? ──
  // Checked on every request, so switching someone off in Settings > Team
  // takes effect immediately. Ryan and Lachlan (ALLOWED_EMAILS) skip the
  // database lookup entirely.
  if (user && !isPublic) {
    const result = await resolveAccess(supabase, user.email);

    if (!result.ok) {
      if (result.reason === "error") {
        // Don't guess. Deny, but don't sign them out over a hiccup.
        return new NextResponse("We couldn't check your access just now. Please refresh in a moment.", { status: 503 });
      }
      // Not on the team any more (or switched off): sign out and show the sign-in page.
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?error=not_allowed";
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }

    if (!can(result.access, routeNeed(path, request.method))) {
      if (path.startsWith("/api/")) {
        return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
      }
      // A page (or a form on one): send them to the first screen they do have.
      const url = request.nextUrl.clone();
      url.pathname = landingPath(result.access);
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
