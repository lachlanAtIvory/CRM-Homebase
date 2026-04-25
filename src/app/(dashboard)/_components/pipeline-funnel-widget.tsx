import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = [
  { label: "Call Booked", pct: 100 },
  { label: "Document Sent", pct: 80 },
  { label: "Quoted", pct: 63 },
  { label: "Approved", pct: 48 },
  { label: "Onboarding", pct: 36 },
  { label: "Final Testing", pct: 25 },
  { label: "Activated", pct: 16 },
  { label: "Live Client", pct: 9 },
];

export function PipelineFunnelWidget() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Funnel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {STAGES.map((stage) => (
          <div key={stage.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground">
              {stage.label}
            </span>
            <div className="flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-5 rounded-sm bg-primary/25 transition-all"
                style={{ width: `${stage.pct}%` }}
              />
            </div>
            <span className="w-4 shrink-0 text-xs text-muted-foreground">0</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
