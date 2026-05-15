import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

// Pin Sydney timezone — this page renders on the Vercel server (UTC), so
// without an explicit timeZone a Monday 9am AEDT meeting (= Sunday 22:00
// UTC) would format as Sunday. AU-focused CRM, AU time is correct.
const AU_TZ = "Australia/Sydney";

function formatMeeting(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end   = new Date(endIso);
  const date  = start.toLocaleDateString("en-AU", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
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

export default async function CalendarPage() {
  const supabase = await createClient();

  const now      = new Date().toISOString();
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, start_time, end_time, meeting_link, attendees")
    .gte("start_time", now)
    .lte("start_time", thirtyDays)
    .order("start_time", { ascending: true })
    .limit(50);

  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-medium">Upcoming Meetings</h2>
        <p className="text-xs text-muted-foreground">Next 30 days</p>
      </div>

      {!meetings || meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <CalendarDays size={32} className="opacity-30" />
          <p className="text-sm">No meetings scheduled</p>
          <p className="text-xs">Syncs from Google Calendar via n8n</p>
        </div>
      ) : (
        <div className="divide-y">
          {meetings.map((m) => {
            const { date, time } = formatMeeting(m.start_time, m.end_time);
            const attendees = Array.isArray(m.attendees) ? m.attendees as string[] : [];
            return (
              <div key={m.id} className="flex items-start gap-4 px-5 py-4">
                <CalendarDays
                  size={16}
                  className="mt-0.5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{m.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {date} · {time}
                  </p>
                  {attendees.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {attendees.join(", ")}
                    </p>
                  )}
                </div>
                {m.meeting_link && (
                  <a
                    href={m.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted"
                  >
                    Join
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
