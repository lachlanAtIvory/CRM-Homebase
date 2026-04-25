import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function UpcomingMeetingsWidget({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Upcoming Meetings</CardTitle>
        <p className="text-xs text-muted-foreground">Next 7 days</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <CalendarDays size={28} className="opacity-30" />
          <p className="text-sm">No meetings scheduled</p>
          <p className="text-xs">Syncs from Google Calendar via n8n</p>
        </div>
      </CardContent>
    </Card>
  );
}
