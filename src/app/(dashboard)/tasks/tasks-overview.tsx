"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, ListTodo, Bell, BellRing, BellOff, Plus, Loader2, Briefcase } from "lucide-react";
import { playSuccessChime, unlockAudio } from "@/lib/sounds";
import {
  OpenTaskRow,
  isOverdue,
  formatDateOnly,
  type Task as BaseTask,
} from "@/app/(dashboard)/clients/[id]/tasks-section";

type Task = BaseTask & {
  client_id:   string | null;
  client_name: string | null;
};

export function TasksOverview({ initialTasks }: { initialTasks: Task[] }) {
  const [tasks,    setTasks]    = useState<Task[]>(initialTasks);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Internal-task add form state
  const [newTitle,   setNewTitle]   = useState("");
  const [newDate,    setNewDate]    = useState("");
  const [newTime,    setNewTime]    = useState("");
  const [adding,     setAdding]     = useState(false);

  async function addInternalTask() {
    if (!newTitle.trim()) return;
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        client_id: null, // internal admin task — not tied to a client
        title:     newTitle.trim(),
        due_date:  newDate || null,
        due_time:  newTime || null,
      })
      .select("id, client_id, title, due_date, due_time, completed_at, created_at")
      .single();
    setAdding(false);

    if (!error && data) {
      setTasks((prev) => [
        {
          id:           data.id as string,
          client_id:    null,
          client_name:  null,
          title:        data.title as string,
          due_date:     data.due_date     as string | null,
          due_time:     data.due_time     as string | null,
          completed_at: data.completed_at as string | null,
          created_at:   data.created_at   as string,
        },
        ...prev,
      ]);
      setNewTitle("");
      setNewDate("");
      setNewTime("");
      toast.success("Internal task added");
    } else {
      toast.error("Could not add task");
    }
  }

  const { open, completed, overdueCount, currentCount } = useMemo(() => {
    const open      = tasks.filter((t) => !t.completed_at);
    const completed = tasks.filter((t) =>  t.completed_at);
    const overdueCount = open.filter(isOverdue).length;
    const currentCount = open.length - overdueCount;
    return { open, completed, overdueCount, currentCount };
  }, [tasks]);

  async function completeTask(id: string) {
    unlockAudio();
    playSuccessChime();

    const now = new Date().toISOString();
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

  async function saveTask(id: string, updates: Partial<Pick<Task, "title" | "due_date" | "due_time">>) {
    const supabase = createClient();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    const { error } = await supabase
      .from("tasks")
      .update({
        title:    updates.title?.trim(),
        due_date: updates.due_date || null,
        due_time: updates.due_time || null,
      })
      .eq("id", id);
    if (error) {
      toast.error("Could not save changes");
      return false;
    }
    toast.success("Task updated");
    return true;
  }

  return (
    <div className="space-y-6">
      {/* ───── Stats dots + notification toggle ───── */}
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
        <NotificationToggle />
      </div>

      {/* ───── Add internal task ───── */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <div className="mb-3 flex items-center gap-2">
          <Briefcase size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">Add Internal Task</h2>
          <span className="text-xs text-muted-foreground">— for admin work not tied to a client</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addInternalTask()}
            placeholder="e.g. Renew domain, follow up with accountant…"
            className="min-w-0 flex-1 basis-48 rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            disabled={!newDate}
            title={!newDate ? "Set a date first" : "Optional time"}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={addInternalTask}
            disabled={adding || !newTitle.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>
      </div>

      {/* ───── Open tasks list ───── */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="mb-4 text-sm font-semibold">Open Tasks</h2>

        {open.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <ListTodo size={28} className="opacity-30" />
            <p className="text-sm">All caught up — no open tasks</p>
            <p className="text-xs">Add one above, or open a client to add a client-linked task</p>
          </div>
        ) : (
          <div className="space-y-2">
            {open
              .slice()
              .sort((a, b) => {
                // Overdue first, then by due date, then by due time
                const aOver = isOverdue(a) ? 0 : 1;
                const bOver = isOverdue(b) ? 0 : 1;
                if (aOver !== bOver) return aOver - bOver;
                if (!a.due_date) return 1;
                if (!b.due_date) return -1;
                const cmp = a.due_date.localeCompare(b.due_date);
                if (cmp !== 0) return cmp;
                if (!a.due_time) return 1;
                if (!b.due_time) return -1;
                return a.due_time.localeCompare(b.due_time);
              })
              .map((task) => (
                <OpenTaskRow
                  key={task.id}
                  task={task}
                  editing={editingId === task.id}
                  onStartEdit={() => setEditingId(task.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onComplete={() => completeTask(task.id)}
                  onSave={async (updates) => {
                    const ok = await saveTask(task.id, updates);
                    if (ok) setEditingId(null);
                  }}
                  leftSlot={
                    task.client_id && task.client_name ? (
                      <Link
                        href={`/clients/${task.client_id}`}
                        className="truncate text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                      >
                        {task.client_name}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <Briefcase size={9} />
                        Internal
                      </span>
                    )
                  }
                />
              ))}
          </div>
        )}

        {/* ───── Completed history ───── */}
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
                  .slice()
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
                          {task.client_id && task.client_name ? (
                            <Link
                              href={`/clients/${task.client_id}`}
                              className="text-xs text-muted-foreground hover:text-primary hover:underline"
                            >
                              {task.client_name}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                              <Briefcase size={9} />
                              Internal
                            </span>
                          )}
                          {task.completed_at && (
                            <span className="text-xs text-muted-foreground">
                              Completed {formatDateOnly(task.completed_at.split("T")[0])}
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

// ─── Browser-notification opt-in card ───────────────────────────────────────
function NotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  async function enable() {
    if (permission !== "default") return;
    unlockAudio(); // also unlock audio for reminder dings
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      toast.success("Browser reminders enabled", {
        description: "You'll get a desktop notification 10 min before each task is due.",
      });
      // Test notification so they know it works
      try {
        new Notification("Reminders enabled ✓", {
          body: "Agent Ivory will alert you 10 min before tasks are due.",
          icon: "/favicon.ico",
        });
      } catch { /* noop */ }
    } else if (result === "denied") {
      toast.error("Reminders blocked", {
        description: "Enable notifications for this site in your browser settings.",
      });
    }
  }

  if (permission === "unsupported") return null;

  const config = {
    default: {
      icon: Bell,
      title: "Enable reminders",
      sub:   "Click for desktop alerts 10 min before due",
      onClick: enable,
      ring: "",
    },
    granted: {
      icon: BellRing,
      title: "Reminders on",
      sub:   "Desktop alerts 10 min before each due time",
      onClick: undefined,
      ring: "ring-primary/20",
    },
    denied: {
      icon: BellOff,
      title: "Reminders blocked",
      sub:   "Enable in browser settings",
      onClick: undefined,
      ring: "ring-destructive/20",
    },
  } as const;

  const c = config[permission as keyof typeof config];
  const Icon = c.icon;

  return (
    <button
      type="button"
      onClick={c.onClick}
      disabled={!c.onClick}
      className={cn(
        "flex min-w-[200px] flex-1 items-center gap-3 rounded-xl border bg-card p-4 text-left ring-1 ring-foreground/5 transition-all duration-150",
        "sm:flex-none",
        c.ring,
        c.onClick && "hover:bg-muted/30 active:scale-[0.98] cursor-pointer",
      )}
    >
      <span className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        permission === "granted"  ? "bg-primary/10 text-primary"
        : permission === "denied" ? "bg-destructive/10 text-destructive"
                                  : "bg-muted text-muted-foreground",
      )}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{c.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{c.sub}</div>
      </div>
    </button>
  );
}

// ─── Stat card with coloured dot ────────────────────────────────────────────
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
