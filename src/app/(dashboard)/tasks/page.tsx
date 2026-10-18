import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess } from "@/lib/hq/access-guard";
import { can } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadTeam } from "@/lib/hq/team-admin";
import { TasksOverview } from "./tasks-overview";

export default async function TasksPage() {
  const supabase = await createClient();
  const access = await getEffectiveAccess();
  const isManager = !!access && can(access, "manager");

  // Separate queries — avoids embedded-join schema-cache issues.
  // Managers see every task; anyone else sees only tasks they created or that
  // were assigned to them (the database enforces that, not this page).
  // The owner columns come from the tasks-ownership migration; until it has been
  // run, load without them so the page keeps working.
  let ownership = true;
  let rows: Record<string, unknown>[] = [];
  const withOwners = await supabase
    .from("tasks")
    .select("id, client_id, title, due_date, due_time, completed_at, created_at, created_by, assigned_to")
    .order("created_at", { ascending: false });
  if (withOwners.error) {
    ownership = false;
    const plain = await supabase
      .from("tasks")
      .select("id, client_id, title, due_date, due_time, completed_at, created_at")
      .order("created_at", { ascending: false });
    rows = (plain.data ?? []) as Record<string, unknown>[];
  } else {
    rows = (withOwners.data ?? []) as Record<string, unknown>[];
  }
  const { data: clients } = await supabase.from("clients").select("id, company_name");
  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]));

  // Hydrate each task with its client_name so the client component is dumb.
  // client_id is nullable — internal admin tasks live without a client link.
  const hydrated = rows.map((t) => {
    const cid = (t.client_id ?? null) as string | null;
    return {
      id:           t.id as string,
      client_id:    cid,
      client_name:  cid ? (clientNameById.get(cid) ?? null) : null,
      title:        t.title as string,
      due_date:     t.due_date as string | null,
      due_time:     t.due_time as string | null,
      completed_at: t.completed_at as string | null,
      created_at:   t.created_at as string,
      created_by:   (t.created_by as string | null | undefined) ?? null,
      assigned_to:  (t.assigned_to as string | null | undefined) ?? null,
    };
  });

  // Who a manager can hand a task to: the founders and everyone on the team who isn't switched off.
  let people: { email: string; name: string }[] = [];
  if (isManager) {
    const team = await loadTeam(adminClient());
    people = [
      ...team.founders.map((f) => ({ email: f.email, name: f.name })),
      ...team.members.filter((m) => m.status !== "deactivated").map((m) => ({ email: m.email, name: m.name ?? m.email.split("@")[0] })),
    ];
  }

  return (
    <TasksOverview
      initialTasks={hydrated}
      viewer={{ email: (access?.email ?? "").toLowerCase(), isManager }}
      people={people}
      ownership={ownership}
    />
  );
}
