import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { fetchEarnings } from "@/lib/hq/earnings";
import { RevenueChart } from "./revenue-chart";

/**
 * Revenue chart — real money, not estimates. Plots PAID client invoices by
 * the month they were paid (upload invoices on a client's page and mark
 * them paid). Previously this summed deal values at the "Live client"
 * stage, which never reflected what was actually received.
 */
export async function RevenueChartWidget({ className }: { className?: string }) {
  const supabase = await createClient();
  const { byMonth } = await fetchEarnings(supabase);

  const hasRevenue = byMonth.some((d) => d.revenue > 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
        <p className="text-xs text-muted-foreground">
          {hasRevenue ? "Paid invoices · AUD" : "Awaiting paid invoices · AUD"}
        </p>
      </CardHeader>
      <CardContent>
        <RevenueChart data={byMonth} />
      </CardContent>
    </Card>
  );
}
