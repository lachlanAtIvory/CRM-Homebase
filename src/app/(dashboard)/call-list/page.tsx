import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchCallLeads, fetchTabCounts, isMissingTable } from "@/lib/hq/call-leads";
import { actorFromEmail, fetchMotivationStats } from "@/lib/hq/motivation-stats";
import { CallList } from "./call-list";

/**
 * Call List — the scraped leads the cold caller works through.
 *
 * Leads are imported from the Google Sheet at /call-list/import. Outcomes
 * and notes are logged against each lead (and counted on the Motivation
 * dashboard); the sheet itself is never edited.
 */
export const dynamic = "force-dynamic";

export default async function CallListPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actor = actorFromEmail(user?.email);

  const [result, counts, stats] = await Promise.all([
    fetchCallLeads(supabase, { tab: "todo" }),
    fetchTabCounts(supabase),
    fetchMotivationStats(supabase, actor),
  ]);

  if (result.error) {
    const missing = isMissingTable(result.error);
    return (
      <div className="mx-auto max-w-xl rounded-xl border bg-card p-8 ring-1 ring-foreground/5">
        <h2 className="text-base font-semibold">{missing ? "One setup step left" : "Couldn't load the call list"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {missing
            ? "The call list tables don't exist yet. Open the Supabase SQL editor, paste in supabase/migrations/20261013150000_add_call_leads.sql, and run it. Then reload this page."
            : result.error.message}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">Back to Home</Link>
      </div>
    );
  }

  return <CallList initial={{ leads: result.leads, total: result.total, counts, stats }} />;
}
