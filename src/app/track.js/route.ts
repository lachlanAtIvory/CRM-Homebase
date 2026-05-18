import { NextRequest, NextResponse } from "next/server";

/**
 * Public tracking script served at /track.js
 *
 * Designed to be impossible to break the host website:
 *   - Entire script body wrapped in try/catch
 *   - Uses navigator.sendBeacon (fire-and-forget, never blocks)
 *   - Falls back to a no-op if sessionStorage / sendBeacon are unavailable
 *   - Pauses heartbeats when the tab is hidden
 *   - No external dependencies, no global namespace pollution
 *   - Cached at edge for 1h so it's only fetched occasionally
 */

export const runtime = "edge";

export async function GET(req: NextRequest) {
  // Resolve the API endpoint URL from the request itself, so the same
  // script works on preview deployments and production without rebuild
  const origin = new URL(req.url).origin;
  const endpoint = `${origin}/api/track`;

  const js = `;(function(){
  try {
    if (typeof window === "undefined") return;
    if (!("sendBeacon" in navigator)) return;
    var ss = null;
    try { ss = window.sessionStorage; } catch (e) { return; }
    if (!ss) return;

    var EP = ${JSON.stringify(endpoint)};
    var SITE_ID = "agentivory";
    var HEARTBEAT_MS = 15000;

    function rand() {
      return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    }

    var sid = ss.getItem("aiv_sid");
    if (!sid) { sid = rand(); ss.setItem("aiv_sid", sid); }

    var vid = null;
    try {
      vid = localStorage.getItem("aiv_vid");
      if (!vid) { vid = rand(); localStorage.setItem("aiv_vid", vid); }
    } catch (e) { /* localStorage blocked — visitor_id stays null */ }

    function send(eventType) {
      try {
        var payload = {
          site_id:    SITE_ID,
          session_id: sid,
          visitor_id: vid,
          event_type: eventType,
          path:       location.pathname + location.search,
          referrer:   document.referrer || null,
        };
        var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        navigator.sendBeacon(EP, blob);
      } catch (e) { /* never throw */ }
    }

    // Initial pageview
    send("pageview");

    // Heartbeats — but only while the tab is visible
    var hb = null;
    function startHB() { if (!hb) hb = setInterval(function(){ send("heartbeat"); }, HEARTBEAT_MS); }
    function stopHB()  { if (hb)  { clearInterval(hb); hb = null; } }
    if (document.visibilityState === "visible") startHB();
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible") { send("heartbeat"); startHB(); }
      else                                         stopHB();
    });

    // Re-fire pageview on SPA navigations (Lovable apps are React/SPA)
    var lastPath = location.pathname + location.search;
    function maybePageview() {
      var now = location.pathname + location.search;
      if (now !== lastPath) { lastPath = now; send("pageview"); }
    }
    var _push = history.pushState;
    history.pushState = function() { var r = _push.apply(this, arguments); maybePageview(); return r; };
    var _replace = history.replaceState;
    history.replaceState = function() { var r = _replace.apply(this, arguments); maybePageview(); return r; };
    window.addEventListener("popstate", maybePageview);
  } catch (e) { /* silently disable — never break the host page */ }
})();`;

  return new NextResponse(js, {
    status: 200,
    headers: {
      "Content-Type":  "application/javascript; charset=utf-8",
      // Cache at the edge for 1 hour, allow revalidation
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      // CORS — script is loaded as a <script src>, but allow direct fetch too
      "Access-Control-Allow-Origin": "*",
    },
  });
}
