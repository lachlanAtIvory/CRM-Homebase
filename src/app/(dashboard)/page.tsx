import { ClosedDealsWidget } from "./_components/closed-deals-widget";
import { RevenueChartWidget } from "./_components/revenue-chart-widget";
import { PipelineFunnelWidget } from "./_components/pipeline-funnel-widget";
import { UpcomingMeetingsWidget } from "./_components/upcoming-meetings-widget";
import { AgentActivityWidget } from "./_components/agent-activity-widget";

export default function HomePage() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <ClosedDealsWidget />
      <RevenueChartWidget className="md:col-span-2" />
      <PipelineFunnelWidget />
      <UpcomingMeetingsWidget className="md:col-span-2" />
      <AgentActivityWidget className="md:col-span-3" />
    </div>
  );
}
