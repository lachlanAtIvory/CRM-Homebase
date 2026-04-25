import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const STAGE_ORDER = [
  "call_booked",
  "document_sent",
  "quoted",
  "approved",
  "onboarding",
  "final_testing",
  "activated",
  "live_client",
] as const;

const STAGE_LABELS: Record<string, string> = {
  call_booked:   "Call Booked",
  document_sent: "Document Sent",
  quoted:        "Quoted",
  approved:      "Approved",
  onboarding:    "Setting Up",
  final_testing: "Final Testing",
  activated:     "Activated",
  live_client:   "Live Client",
};

export async function PipelineFunnelWidget() {
  const supabase = await createClient();

  // Only count active pipeline stages (exclude closed_lost / paused)
  const { data } = await supabase
    .from("deals")
    .select("current_stage")
    .not("current_stage", "in", '("closed_lost","paused")');

  const counts: Record<string, number> = {};
  for (const deal of data ?? []) {
    counts[deal.current_stage] = (counts[deal.current_stage] ?? 0) + 1;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...Object.values(counts), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Funnel</CardTitle>
        <p className="text-xs text-muted-foreground">
          {total} active deal{total !== 1 ? "s" : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {STAGE_ORDER.map((stage) => {
          const count = counts[stage] ?? 0;
          const pct = Math.round((count / maxCount) * 100);
          return (
            <div key={stage} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground">
                {STAGE_LABELS[stage]}
              </span>
              <div className="flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-5 rounded-sm bg-primary/25 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
