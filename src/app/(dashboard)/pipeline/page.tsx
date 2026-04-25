const STAGES = [
  "Call Booked",
  "Document Sent",
  "Quoted",
  "Approved",
  "Onboarding",
  "Final Testing",
  "Activated",
  "Live Client",
];

export default function PipelinePage() {
  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-3 pb-4" style={{ minWidth: `${STAGES.length * 220}px` }}>
        {STAGES.map((stage) => (
          <div
            key={stage}
            className="flex w-52 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3 ring-1 ring-foreground/5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {stage}
              </span>
              <span className="text-xs text-muted-foreground">0</span>
            </div>
            <div className="flex-1 rounded-lg border-2 border-dashed border-border/50 p-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
