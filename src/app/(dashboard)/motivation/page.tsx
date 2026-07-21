import { createClient } from "@/lib/supabase/server";
import {
  actorFromEmail, fetchMotivationHistory, fetchMotivationStats,
} from "@/lib/hq/motivation-stats";
import { MotivationDashboard } from "./motivation-dashboard";

/**
 * Motivation — the cold-call dopamine engine.
 *
 * Counters are real prospect_events rows (so they feed the Phase 4
 * scoreboard), booked calls create real pipeline leads, and the objection
 * drills come from the Sales Bible. Zero AI API calls anywhere on this page.
 */
export default async function MotivationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actor = actorFromEmail(user?.email);
  const [stats, history] = await Promise.all([
    fetchMotivationStats(supabase, actor),
    fetchMotivationHistory(supabase, actor),
  ]);

  return <MotivationDashboard initialStats={stats} history={history} actor={actor} />;
}
