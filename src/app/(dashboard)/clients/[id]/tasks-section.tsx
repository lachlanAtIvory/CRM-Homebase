"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, Plus, Loader2 } from "lucide-react";

type Task = {
  id:           string;
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
  const [adding,   setAdding]   = useState(false);
  const [showDone, setShowDone] = useState(false);

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
      })
      .select()
      .single();
    setAdding(false);
    if (!error && data) {
      setTasks((prev) => [data, ...prev]);
      setTitle("");
      setDueDate("");
      toast.success("Task added");
    } else {
      toast.error("Could not add task");
    }
  }

  async function completeTask(id: string) {
    const supabase = createClient();
    const now = new Date().toISOString();
    // Optimistic update — flip state first, revert on error
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
      // revert
      const now = new Date().toISOString();
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed_at: now } : t)),
      );
      toast.error("Could not reopen task");
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <h2 className="mb-4 text-sm font-semibold">Tasks</h2>

      {/* Add task form */}
      <div className="mb-5 flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="New task…"
          className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
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

      {/* Open tasks */}
      {open.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No open tasks — add one above
        </p>
      ) : (
        <div className="space-y-2">
          {open
            .sort((a, b) => {
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
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors animate-in fade-in slide-in-from-top-1 duration-200",
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
                    {task.due_date && (
                      <div className="mt-0.5 flex items-center gap-1">
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
              );
            })}
        </div>
      )}

      {/* Completed tasks (history) */}
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
                          Completed {formatDate(task.completed_at)}
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
