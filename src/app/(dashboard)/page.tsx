import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/hq/access";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { ClosedDealsWidget } from "./_components/closed-deals-widget";
import { RevenueChartWidget } from "./_components/revenue-chart-widget";
import { EarningsTableWidget } from "./_components/earnings-table-widget";
import { PipelineFunnelWidget } from "./_components/pipeline-funnel-widget";
import { UpcomingMeetingsWidget } from "./_components/upcoming-meetings-widget";
import { UpcomingTasksWidget } from "./_components/upcoming-tasks-widget";

export default async function HomePage() {
  // Revenue and earnings are money: they only show with "Revenue and invoices".
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  const showMoney = access.ok && can(access.access, "finance");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <ClosedDealsWidget />
      {showMoney && <RevenueChartWidget className="md:col-span-2" />}
      {showMoney && <EarningsTableWidget className="md:col-span-3" />}
      <PipelineFunnelWidget />
      <UpcomingMeetingsWidget className="md:col-span-2" />
      <UpcomingTasksWidget className="md:col-span-3" />
    </div>
  );
}
