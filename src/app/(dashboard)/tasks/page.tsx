import { createClient } from "@/lib/supabase/server";
import { TasksOverview } from "./tasks-overview";

export default async function TasksPage() {
  const supabase = await createClient();

  // Separate queries — avoids embedded-join schema-cache issues
  const [{ data: tasks }, { data: clients }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, client_id, title, due_date, due_time, completed_at, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, company_name"),
  ]);

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]));

  // Hydrate each task with its client_name so the client component is dumb
  const hydrated = (tasks ?? []).map((t) => ({
    id:           t.id as string,
    client_id:    t.client_id as string,
    client_name:  clientNameById.get(t.client_id) ?? "—",
    title:        t.title as string,
    due_date:     t.due_date as string | null,
    due_time:     t.due_time as string | null,
    completed_at: t.completed_at as string | null,
    created_at:   t.created_at as string,
  }));

  return <TasksOverview initialTasks={hydrated} />;
}
