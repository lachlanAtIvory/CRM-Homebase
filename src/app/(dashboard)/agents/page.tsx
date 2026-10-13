import { createClient } from "@/lib/supabase/server";
import { MissionControl } from "./mission-control";

/**
 * HQ Mission Control — a card per n8n agent workflow.
 *
 * Cards come from src/lib/hq/agents-config.ts (Ryan edits config, not
 * components). This server component supplies the signed client list,
 * used by any card field configured with `optionsFrom: "hq_clients"`.
 */
export default async function AgentsPage() {
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("hq_clients")
    .select("id, name")
    .order("name", { ascending: true });

  return <MissionControl clients={(clients ?? []) as { id: string; name: string }[]} />;
}
