import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { RevenueChart, type RevenueDataPoint } from "./revenue-chart";

export async function RevenueChartWidget({ className }: { className?: string }) {
  const supabase = await createClient();

  // Find deals that transitioned to live_client (= revenue events), with their value
  const { data: history } = await supabase
    .from("stage_history")
    .select("changed_at, deal_id")
    .eq("to_stage", "live_client")
    .order("changed_at", { ascending: true });

  let chartData: RevenueDataPoint[] = [];

  if (history && history.length > 0) {
    const dealIds = history.map((h) => h.deal_id);

    const { data: deals } = await supabase
      .from("deals")
      .select("id, deal_value_aud")
      .in("id", dealIds);

    const valueById = Object.fromEntries(
      (deals ?? []).map((d) => [d.id, d.deal_value_aud ?? 0]),
    );

    // Group by "Mon YY"
    const byMonth: Record<string, number> = {};
    for (const h of history) {
      const label = new Date(h.changed_at).toLocaleDateString("en-AU", {
        month: "short",
        year:  "2-digit",
      });
      byMonth[label] = (byMonth[label] ?? 0) + (valueById[h.deal_id] ?? 0);
    }

    chartData = Object.entries(byMonth).map(([month, revenue]) => ({
      month,
      revenue,
    }));
  }

  const hasRevenue = chartData.some((d) => d.revenue > 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
        <p className="text-xs text-muted-foreground">
          {hasRevenue ? "Live clients · AUD" : "Awaiting live data · AUD"}
        </p>
      </CardHeader>
      <CardContent>
        <RevenueChart data={chartData} />
      </CardContent>
    </Card>
  );
}
