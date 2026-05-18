import { createClient } from "@/lib/supabase/server";
import { AnalyticsDashboard } from "./analytics-dashboard";

const SITE_ID = "agentivory";

export default async function AnalyticsPage() {
  const supabase = await createClient();

  const now           = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fiveMinAgo    = new Date(Date.now() -  5 * 60       * 1000);

  // Pull the last 30 days of events in one shot — the dashboard does all
  // its slicing/aggregation in JS. Keeps the query simple, the dashboard
  // snappy, and means future widgets don't need new queries.
  const { data: events } = await supabase
    .from("analytics_events")
    .select("id, event_type, session_id, visitor_id, path, referrer, country, device, browser, os, created_at")
    .eq("site_id", SITE_ID)
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(20000);

  // Count active visitors right now (distinct sessions w/ a heartbeat in
  // the last 5 minutes). We compute this server-side too so the initial
  // paint has a real number, not 0 flashing.
  const recentSessions = new Set<string>();
  for (const e of events ?? []) {
    if (new Date(e.created_at as string) >= fiveMinAgo) {
      recentSessions.add(e.session_id as string);
    }
  }

  return (
    <AnalyticsDashboard
      initialEvents={(events ?? []) as never}
      initialActiveCount={recentSessions.size}
      serverNowIso={now.toISOString()}
    />
  );
}
