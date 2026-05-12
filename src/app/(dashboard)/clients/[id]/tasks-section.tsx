"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, Plus, Loader2, Pencil, X, Save } from "lucide-react";

export type Task = {
  id:           string;
  title:        string;
  due_date:     string | null;
  due_time:     string | null; // HH:MM:SS or HH:MM
  completed_at: string | null;
  created_at:   string;
};

// ─── Overdue check considers time when present ──────────────────────────────
export function isOverdue(task: Task): boolean {
  if (task.completed_at || !task.due_date) return false;
  const today = new Date();
  const dueDay = new Date(task.due_date + "T00:00:00");
  // Strip time from today for date-only comparison
  const todayDay = new Date(today.toDateString());
  if (dueDay < todayDay) return true;
  if (dueDay.getTime() !== todayDay.getTime()) return false; // future day
  // Same day — only overdue if due_time has passed
  if (!task.due_time) return false;
  const [h, m] = task.due_time.split(":").map(Number);
  return today.getHours() > h || (today.getHours() === h && today.getMinutes() > (m ?? 0));
}

// ─── Format helpers ─────────────────────────────────────────────────────────
export function formatDateOnly(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function formatTime(time: string): string {
  // Accept "HH:MM" or "HH:MM:SS" → return "h:MM AM/PM"
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m ?? 0, 0, 0);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatDueLabel(task: Task): string {
  if (!task.due_date) return "";
  const date = formatDateOnly(task.due_date);
  return task.due_time ? `${date} · ${formatTime(task.due_time)}` : date;
}

// ─── Component ──────────────────────────────────────────────────────────────
export function TasksSection({
  clientId,
  initialTasks,
}: {
  clientId:     string;
  initialTasks: Task[];
}) {
  const [tasks,    setTasks]    = useState<Task[]>(initialTasks);
  const [title,    setTitle]    = useState("");
  const [dueDate,  setDueDate]  = useState("");
  const [dueTime,  setDueTime]  = useState("");
  const [adding,   setAdding]   = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const open      = tasks.filter((t) => !t.completed_at);
  const completed = tasks.filter((t) =>  t.completed_at);

  async function addTask() {
    if (!title.trim()) return;
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        client_id: clientId,
        title:     title.trim(),
        due_date:  dueDate || null,
        due_time:  dueTime || null,
      })
      .select()
      .single();
    setAdding(false);
    if (!error && data) {
      setTasks((prev) => [data as Task, ...prev]);
      setTitle("");
      setDueDate("");
      setDueTime("");
      toast.success("Task added");
    } else {
      toast.error("Could not add task");
    }
  }

  async function completeTask(id: string) {
    const supabase = createClient();
    const now = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed_at: now } : t)),
    );
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
    const supabase = createClient();
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed_at: null } : t)),
    );
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
    // Optimistic
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
    <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <h2 className="mb-4 text-sm font-semibold">Tasks</h2>

      {/* ───── Add task form ───── */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="New task…"
          className="min-w-0 flex-1 basis-48 rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
        />
        <input
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
          disabled={!dueDate}
          title={!dueDate ? "Set a date first" : "Optional time"}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          onClick={addTask}
          disabled={adding || !title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </div>

      {/* ───── Open tasks ───── */}
      {open.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No open tasks — add one above
        </p>
      ) : (
        <div className="space-y-2">
          {open
            .slice()
            .sort((a, b) => {
              if (!a.due_date) return 1;
              if (!b.due_date) return -1;
              const cmp = a.due_date.localeCompare(b.due_date);
              if (cmp !== 0) return cmp;
              // Same date → sort by time (nulls last)
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
              />
            ))}
        </div>
      )}

      {/* ───── Completed tasks (history) ───── */}
      {completed.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
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
                      {task.completed_at && (
                        <p className="text-xs text-muted-foreground">
                          Completed {formatDateOnly(task.completed_at.split("T")[0])}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row for an open task — supports display + inline edit modes ───────────
export function OpenTaskRow({
  task,
  editing,
  onStartEdit,
  onCancelEdit,
  onComplete,
  onSave,
  leftSlot,
}: {
  task:          Task;
  editing:       boolean;
  onStartEdit:   () => void;
  onCancelEdit:  () => void;
  onComplete:    () => void;
  onSave:        (updates: Partial<Pick<Task, "title" | "due_date" | "due_time">>) => void;
  // Optional extra slot to render below the title (used by global Tasks page for client link)
  leftSlot?:     React.ReactNode;
}) {
  const overdue = isOverdue(task);

  // Local edit state
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDate,  setEditDate]  = useState(task.due_date ?? "");
  const [editTime,  setEditTime]  = useState(task.due_time?.slice(0, 5) ?? "");

  function startEdit() {
    setEditTitle(task.title);
    setEditDate(task.due_date ?? "");
    setEditTime(task.due_time?.slice(0, 5) ?? "");
    onStartEdit();
  }

  function handleSave() {
    if (!editTitle.trim()) return;
    onSave({
      title:    editTitle,
      due_date: editDate,
      due_time: editTime,
    });
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border p-3 transition-colors animate-in fade-in slide-in-from-top-1 duration-200",
        overdue && !editing && "border-destructive/40 bg-destructive/5",
        editing && "border-primary/40 bg-primary/5",
      )}
    >
      {/* Edit icon (left) — always visible, but subtle until hover */}
      {!editing && (
        <button
          onClick={startEdit}
          className="mt-0.5 shrink-0 text-muted-foreground/50 transition-all duration-150 hover:text-primary active:scale-90 group-hover:text-muted-foreground"
          title="Edit task"
          aria-label="Edit task"
        >
          <Pencil size={14} />
        </button>
      )}
      {editing && (
        <button
          onClick={onCancelEdit}
          className="mt-0.5 shrink-0 text-muted-foreground transition-all duration-150 hover:text-destructive active:scale-90"
          title="Cancel edit"
          aria-label="Cancel edit"
        >
          <X size={14} />
        </button>
      )}

      {/* Complete circle */}
      <button
        onClick={onComplete}
        disabled={editing}
        className="mt-0.5 shrink-0 text-muted-foreground transition-all duration-150 hover:text-primary active:scale-90 disabled:opacity-30"
        title="Mark complete"
      >
        <Circle size={16} />
      </button>

      {/* Body — display OR edit form */}
      <div className="min-w-0 flex-1">
        {!editing ? (
          <>
            <p className="text-sm">{task.title}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {leftSlot}
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
                    {formatDueLabel(task)}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") onCancelEdit();
              }}
              autoFocus
              placeholder="Task title…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs outline-none ring-1 ring-transparent focus:ring-primary/40"
              />
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                disabled={!editDate}
                className="rounded-md border bg-background px-2 py-1 text-xs outline-none ring-1 ring-transparent focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {editTime && (
                <button
                  onClick={() => setEditTime("")}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Clear time"
                >
                  Clear time
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!editTitle.trim()}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.95] disabled:opacity-50"
              >
                <Save size={12} />
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
