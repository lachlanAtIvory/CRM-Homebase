"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, ListTodo } from "lucide-react";

type Task = {
  id:           string;
  client_id:    string;
  client_name:  string;
  title:        string;
  due_date:     string | null;
  completed_at: string | null;
  created_at:   string;
};

function isOverdue(task: Task) {
  if (task.completed_at || !task.due_date) return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function TasksOverview({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks,    setTasks]    = useState<Task[]>(initialTasks);
  const [showDone, setShowDone] = useState(false);

  const { open, completed, overdueCount, currentCount } = useMemo(() => {
    const open      = tasks.filter((t) => !t.completed_at);
    const completed = tasks.filter((t) =>  t.completed_at);
    const overdueCount = open.filter(isOverdue).length;
    const currentCount = open.length - overdueCount;
    return { open, completed, overdueCount, currentCount };
  }, [tasks]);

  async function completeTask(id: string) {
    const now = new Date().toISOString();
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed_at: now } : t)),
    );

    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: now })
      .eq("id", id);

    if (error) {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed_at: null } : t)),
      );
      toast.error("Could not complete task");
    } else {
      toast.success("Task completed 🎉");
    }
  }

  async function reopenTask(id: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed_at: null } : t)),
    );

    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: null })
      .eq("id", id);

    if (error) {
      const now = new Date().toISOString();
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed_at: now } : t)),
      );
      toast.error("Could not reopen task");
    }
  }

  return (
    <div className="space-y-6">
      {/* ───────── Stats dots ───────── */}
      <div className="flex flex-wrap items-stretch gap-3">
        <StatCard
          dotColor="bg-emerald-500"
          label="Current"
          count={currentCount}
        />
        <StatCard
          dotColor="bg-destructive"
          label="Overdue"
          count={overdueCount}
          urgent={overdueCount > 0}
        />
      </div>

      {/* ───────── Open tasks list ───────── */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="mb-4 text-sm font-semibold">Open Tasks</h2>

        {open.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <ListTodo size={28} className="opacity-30" />
            <p className="text-sm">All caught up — no open tasks</p>
            <p className="text-xs">Open a client to add new tasks</p>
          </div>
        ) : (
          <div className="space-y-2">
            {open
              .sort((a, b) => {
                // Overdue first, then by due date
                const aOver = isOverdue(a) ? 0 : 1;
                const bOver = isOverdue(b) ? 0 : 1;
                if (aOver !== bOver) return aOver - bOver;
                if (!a.due_date) return 1;
                if (!b.due_date) return -1;
                return a.due_date.localeCompare(b.due_date);
              })
              .map((task) => {
                const overdue = isOverdue(task);
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "group flex items-start gap-3 rounded-lg border p-3 transition-all duration-150 hover:bg-muted/30",
                      overdue && "border-destructive/40 bg-destructive/5",
                    )}
                  >
                    <button
                      onClick={() => completeTask(task.id)}
                      className="mt-0.5 shrink-0 text-muted-foreground transition-all duration-150 hover:text-primary active:scale-90"
                      title="Mark complete"
                    >
                      <Circle size={16} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <Link
                          href={`/clients/${task.client_id}`}
                          className="truncate text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                        >
                          {task.client_name}
                        </Link>
                        {task.due_date && (
                          <div className="flex items-center gap-1">
                            <Clock
                              size={11}
                              className={overdue ? "text-destructive" : "text-muted-foreground"}
                            />
                            <span
                              className={cn(
                                "text-xs",
                                overdue ? "font-medium text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {overdue ? "Overdue · " : "Due "}
                              {formatDate(task.due_date)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* ───────── Completed history ───────── */}
        {completed.length > 0 && (
          <div className="mt-5 border-t pt-4">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {showDone ? "▾" : "▸"} History ({completed.length} completed)
            </button>
            {showDone && (
              <div className="mt-2 space-y-2">
                {completed
                  .sort((a, b) =>
                    (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
                  )
                  .map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 opacity-60"
                    >
                      <button
                        onClick={() => reopenTask(task.id)}
                        className="mt-0.5 shrink-0 text-primary transition-transform duration-150 hover:scale-110 active:scale-90"
                        title="Reopen task"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm line-through">{task.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
                          <Link
                            href={`/clients/${task.client_id}`}
                            className="text-xs text-muted-foreground hover:text-primary hover:underline"
                          >
                            {task.client_name}
                          </Link>
                          {task.completed_at && (
                            <span className="text-xs text-muted-foreground">
                              Completed {formatDate(task.completed_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Stat card with coloured dot — top of the page
// ───────────────────────────────────────────────────────────────────────────
function StatCard({
  dotColor,
  label,
  count,
  urgent,
}: {
  dotColor: string;
  label:    string;
  count:    number;
  urgent?:  boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[140px] flex-1 items-center gap-3 rounded-xl border bg-card p-4 ring-1 ring-foreground/5 transition-all duration-150",
        "sm:flex-none",
        urgent && "ring-destructive/20",
      )}
    >
      <span className="relative flex h-3 w-3 shrink-0">
        {urgent && (
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", dotColor)} />
        )}
        <span className={cn("relative inline-flex h-3 w-3 rounded-full", dotColor)} />
      </span>
      <div>
        <div className="text-2xl font-bold leading-none tracking-tight">{count}</div>
        <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
