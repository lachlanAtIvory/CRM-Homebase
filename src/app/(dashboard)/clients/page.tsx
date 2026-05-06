import { createClient } from "@/lib/supabase/server";
import { ClientsTable } from "./clients-table";

export default async function ClientsPage() {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];

  const [{ data: clients }, { data: overdueTasks }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, contact_name, deals(current_stage, deal_value_aud, updated_at)")
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("client_id")
      .is("completed_at", null)
      .lt("due_date", today),
  ]);

  const overdueClientIds = (overdueTasks ?? []).map((t) => t.client_id as string);

  return (
    <ClientsTable
      clients={(clients ?? []) as any}
      overdueClientIds={overdueClientIds}
    />
  );
}
