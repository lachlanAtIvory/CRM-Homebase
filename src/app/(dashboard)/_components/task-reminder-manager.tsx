"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { playReminderDing } from "@/lib/sounds";

const REMINDER_OFFSET_MS = 10 * 60 * 1000; // 10 minutes before due_time
const POLL_INTERVAL_MS   =  5 * 60 * 1000; // re-fetch task list every 5 min
const SCHEDULE_WINDOW_MS = 15 * 60 * 1000; // only schedule reminders within next 15 min

/**
 * Background component that schedules in-browser reminders for tasks that
 * have a due_date AND due_time set. Fires 10 minutes before the due time.
 *
 * Renders nothing. Mount it once in the dashboard layout.
 *
 * Triggers (in order, each fail-safe):
 *  1. In-app sonner toast (always works)
 *  2. Reminder sound chime (works if audio unlocked by prior user gesture)
 *  3. Desktop browser notification (works if user granted permission)
 */
export function TaskReminderManager() {
  const firedRef  = useRef<Set<string>>(new Set());
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const supabase = createClient();
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, client_id, due_date, due_time")
        .is("completed_at", null)
        .not("due_date", "is", null)
        .not("due_time", "is", null);

      if (cancelled || !tasks || tasks.length === 0) return;

      // Pull client names for nicer notification copy
      const clientIds = [...new Set(tasks.map((t) => t.client_id as string))];
      const { data: clients } = await supabase
        .from("clients")
        .select("id, company_name")
        .in("id", clientIds);
      const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.company_name as string]));

      // Clear any previously-scheduled timers — we'll re-schedule from scratch
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];

      const now = Date.now();
      for (const task of tasks) {
        if (firedRef.current.has(task.id as string)) continue;
        const due_date = task.due_date as string | null;
        const due_time = task.due_time as string | null;
        if (!due_date || !due_time) continue;

        // Local-time parse (no timezone suffix → JS treats as local)
        const dueMs  = new Date(`${due_date}T${due_time.slice(0, 5)}:00`).getTime();
        if (Number.isNaN(dueMs)) continue;

        const fireMs = dueMs - REMINDER_OFFSET_MS;
        if (now >= dueMs) continue;                  // already past due
        const delay  = Math.max(0, fireMs - now);
        if (delay > SCHEDULE_WINDOW_MS) continue;    // catch on next poll

        const taskId     = task.id as string;
        const title      = task.title as string;
        const clientId   = task.client_id as string;
        const clientName = clientNameById.get(clientId) ?? "—";

        const timerId = window.setTimeout(() => {
          if (firedRef.current.has(taskId)) return;
          firedRef.current.add(taskId);

          // 1. In-app toast (always)
          toast(`⏰ Due in 10 min — ${title}`, {
            description: clientName,
            duration: 10000,
            action: {
              label: "View",
              onClick: () => {
                window.location.href = `/clients/${clientId}`;
              },
            },
          });

          // 2. Reminder sound (only if audio was unlocked)
          playReminderDing();

          // 3. Desktop notification (only if permission granted)
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification("Task due in 10 minutes", {
                body: `${title} — ${clientName}`,
                icon: "/favicon.ico",
                tag:  `task-${taskId}`,
              });
              n.onclick = () => {
                window.focus();
                window.location.href = `/clients/${clientId}`;
                n.close();
              };
            } catch {
              /* notification API failed — toast already fired */
            }
          }
        }, delay);

        timersRef.current.push(timerId);
      }
    }

    // Fetch immediately, then poll every 5 min for newly-added tasks
    refresh();
    const pollId = window.setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      timersRef.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return null;
}
