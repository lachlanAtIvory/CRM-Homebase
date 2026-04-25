const AGENT_PLACEHOLDERS = [
  { name: "Lead Scraper", category: "Outreach" },
  { name: "Email Agent", category: "Outreach" },
  { name: "Report Generator", category: "Analytics" },
  { name: "Calendar Sync", category: "Operations" },
];

export default function AgentsPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {AGENT_PLACEHOLDERS.map((agent) => (
        <div
          key={agent.name}
          className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5"
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <p className="font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">{agent.category}</p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Inactive
            </span>
          </div>
          <div className="space-y-1.5">
            {["Leads scraped", "Emails sent", "Reports generated", "Responses received"].map(
              (metric) => (
                <div key={metric} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{metric}</span>
                  <span className="font-medium">—</span>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
