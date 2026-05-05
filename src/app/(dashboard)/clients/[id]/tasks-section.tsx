"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, Plus } from "lucide-react";

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
    }
  }

  async function completeTask(id: string) {
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: now })
      .eq("id", id);
    if (!error) {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed_at: now } : t)),
      );
    }
  }

  async function reopenTask(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: null })
      .eq("id", id);
    if (!error) {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed_at: null } : t)),
      );
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
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus size={14} />
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
                    "flex items-start gap-3 rounded-lg border p-3",
                    overdue && "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <button
                    onClick={() => completeTask(task.id)}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
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
                      className="mt-0.5 shrink-0 text-primary"
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
