import { createClient } from "@/lib/supabase/server";
import { MissionControl } from "./mission-control";

/**
 * HQ Mission Control — a card per n8n agent workflow.
 *
 * Cards come from src/lib/hq/agents-config.ts (Ryan edits config, not
 * components). This server component supplies the dynamic bits: the signed
 * client list (Report Generator's dropdown) and each client's most recent
 * call (Call Monitor's status readout).
 */
export default async function AgentsPage() {
  const supabase = await createClient();

  const [{ data: clients }, { data: recentCalls }] = await Promise.all([
    supabase
      .from("hq_clients")
      .select("id, name")
      .order("name", { ascending: true }),
    supabase
      .from("calls")
      .select("client_id, started_at")
      .not("started_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(500),
  ]);

  // Most recent call per client — rows arrive newest-first, keep the first
  // one we see for each client.
  const latestCallByClient: Record<string, string> = {};
  for (const c of recentCalls ?? []) {
    const cid = c.client_id as string | null;
    if (cid && !(cid in latestCallByClient)) {
      latestCallByClient[cid] = c.started_at as string;
    }
  }

  return (
    <MissionControl
      clients={(clients ?? []) as { id: string; name: string }[]}
      latestCallByClient={latestCallByClient}
    />
  );
}
