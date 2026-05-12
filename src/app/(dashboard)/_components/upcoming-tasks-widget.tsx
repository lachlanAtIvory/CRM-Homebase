import Link from "next/link";
import { Clock, ListTodo, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", {
    day: "numeric", month: "short",
  });
}

function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m ?? 0, 0, 0);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

function isOverdue(due: string | null, dueTime: string | null, todayIso: string, now: Date) {
  if (!due) return false;
  if (due < todayIso) return true;
  if (due > todayIso) return false;
  // Same day — overdue only if due_time has passed
  if (!dueTime) return false;
  const [h, m] = dueTime.split(":").map(Number);
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() > (m ?? 0));
}

export async function UpcomingTasksWidget({ className }: { className?: string }) {
  const supabase = await createClient();

  // Open tasks only — sorted with overdue first then by due_date
  const [{ data: tasks }, { data: clients }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, client_id, title, due_date, due_time")
      .is("completed_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from("clients")
      .select("id, company_name"),
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]));
  const now = new Date();
  const todayIso = now.toISOString().split("T")[0];

  const overdueCount = (tasks ?? []).filter((t) => isOverdue(t.due_date, t.due_time, todayIso, now)).length;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Upcoming Tasks</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {overdueCount > 0
                ? <><span className="font-medium text-destructive">{overdueCount} overdue</span> · next up</>
                : "Next up across all clients"}
            </p>
          </div>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
          >
            View all
            <ArrowRight size={12} />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!tasks || tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <ListTodo size={28} className="opacity-30" />
            <p className="text-sm">All caught up</p>
            <p className="text-xs">No open tasks across any clients</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => {
              const overdue = isOverdue(t.due_date, t.due_time, todayIso, now);
              const clientName = clientNameById.get(t.client_id) ?? "—";
              const dueLabel = t.due_date
                ? t.due_time
                  ? `${formatDate(t.due_date)} · ${formatTime(t.due_time)}`
                  : formatDate(t.due_date)
                : "";
              return (
                <Link
                  key={t.id}
                  href={`/clients/${t.client_id}`}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-all duration-150 hover:bg-muted/30",
                    overdue && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                      overdue ? "bg-destructive" : "bg-emerald-500",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{clientName}</span>
                      {dueLabel && (
                        <>
                          <span>·</span>
                          <span
                            className={cn(
                              "flex items-center gap-1",
                              overdue && "font-medium text-destructive",
                            )}
                          >
                            <Clock size={10} />
                            {overdue ? "Overdue " : "Due "}
                            {dueLabel}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
