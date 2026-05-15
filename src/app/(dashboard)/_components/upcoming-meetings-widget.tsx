import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

// Pin Sydney TZ — server renders in UTC otherwise, which day-shifts evening
// meetings (Monday 9am AEDT = Sunday 22:00 UTC, would render as Sunday).
const AU_TZ = "Australia/Sydney";

function formatMeeting(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end   = new Date(endIso);
  const date  = start.toLocaleDateString("en-AU", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    timeZone: AU_TZ,
  });
  const startTime = start.toLocaleTimeString("en-AU", {
    hour:   "2-digit",
    minute: "2-digit",
    timeZone: AU_TZ,
  });
  const endTime = end.toLocaleTimeString("en-AU", {
    hour:   "2-digit",
    minute: "2-digit",
    timeZone: AU_TZ,
  });
  return { date, time: `${startTime} – ${endTime}` };
}

export async function UpcomingMeetingsWidget({ className }: { className?: string }) {
  const supabase = await createClient();

  const now       = new Date().toISOString();
  const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, start_time, end_time, meeting_link")
    .gte("start_time", now)
    .lte("start_time", sevenDays)
    .order("start_time", { ascending: true })
    .limit(10);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Upcoming Meetings</CardTitle>
        <p className="text-xs text-muted-foreground">Next 7 days</p>
      </CardHeader>
      <CardContent>
        {!meetings || meetings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <CalendarDays size={28} className="opacity-30" />
            <p className="text-sm">No meetings scheduled</p>
            <p className="text-xs">Syncs from Google Calendar via n8n</p>
          </div>
        ) : (
          <div className="space-y-2">
            {meetings.map((m) => {
              const { date, time } = formatMeeting(m.start_time, m.end_time);
              return (
                <div
                  key={m.id}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <CalendarDays
                    size={15}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {date} · {time}
                    </p>
                  </div>
                  {m.meeting_link && (
                    <a
                      href={m.meeting_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      Join
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
