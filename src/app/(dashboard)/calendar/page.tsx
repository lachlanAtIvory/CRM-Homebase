import { CalendarDays } from "lucide-react";

export default function CalendarPage() {
  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-medium">Upcoming Meetings</h2>
        <p className="text-xs text-muted-foreground">Next 7 days</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <CalendarDays size={32} className="opacity-30" />
        <p className="text-sm">No meetings scheduled</p>
        <p className="text-xs">Syncs from Google Calendar via n8n</p>
      </div>
    </div>
  );
}
