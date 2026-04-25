import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const AGENTS = [
  { name: "Lead Scraper", category: "Outreach" },
  { name: "Email Agent", category: "Outreach" },
  { name: "Report Generator", category: "Analytics" },
  { name: "Calendar Sync", category: "Operations" },
];

const METRICS = [
  { label: "Leads scraped" },
  { label: "Reports generated" },
  { label: "Emails sent" },
  { label: "Responses received" },
];

export function AgentActivityWidget({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Agent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((agent) => (
            <div
              key={agent.name}
              className="rounded-lg border bg-muted/30 p-3"
            >
              <div className="mb-3">
                <p className="text-sm font-medium">{agent.name}</p>
                <p className="text-xs text-muted-foreground">{agent.category}</p>
              </div>
              <div className="space-y-1.5">
                {METRICS.map((m) => (
                  <div key={m.label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{m.label}</span>
                    <span className="font-medium tabular-nums">—</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
