import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STAGE_LABELS: Record<string, string> = {
  call_booked:   "Call Booked",
  document_sent: "Document Sent",
  quoted:        "Quoted",
  approved:      "Approved",
  onboarding:    "Setting Up",
  final_testing: "Final Testing",
  activated:     "Activated",
  live_client:   "Live Client",
  closed_lost:   "Closed Lost",
  paused:        "Paused",
};

function fmtAud(v: number | null | undefined) {
  if (!v) return "—";
  return `$${v.toLocaleString("en-AU")}`;
}

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

  const overdueClientIds = new Set((overdueTasks ?? []).map((t) => t.client_id as string));

  if (!clients || clients.length === 0) {
    return (
      <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
        <div className="grid grid-cols-5 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <div>Company</div>
          <div>Contact</div>
          <div>Stage</div>
          <div>Deal Value</div>
          <div>Last Updated</div>
        </div>
        <p className="py-16 text-center text-sm text-muted-foreground">
          No clients yet — data syncs from your Google Sheet via n8n.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-5 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground">
        <div>Company</div>
        <div>Contact</div>
        <div>Stage</div>
        <div>Deal Value</div>
        <div>Last Updated</div>
      </div>

      {/* Rows — each is a full Link */}
      <div className="divide-y">
        {clients.map((client) => {
          const deals     = Array.isArray(client.deals) ? client.deals : client.deals ? [client.deals as any] : [];
          const deal      = deals[0];
          const overdue   = overdueClientIds.has(client.id);
          const updatedAt = deal?.updated_at
            ? new Date(deal.updated_at).toLocaleDateString("en-AU", {
                day: "numeric", month: "short", year: "2-digit",
              })
            : "—";

          return (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="grid grid-cols-5 items-center px-4 py-3 text-sm transition-colors hover:bg-muted/50"
            >
              {/* Company */}
              <div className="flex items-center gap-2 font-medium">
                {overdue && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
                    title="Overdue task"
                  />
                )}
                <span className="truncate">{client.company_name}</span>
              </div>

              {/* Contact */}
              <div className="truncate text-muted-foreground">
                {client.contact_name ?? "—"}
              </div>

              {/* Stage */}
              <div>
                {deal?.current_stage ? (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {STAGE_LABELS[deal.current_stage] ?? deal.current_stage}
                  </span>
                ) : "—"}
              </div>

              {/* Deal Value */}
              <div className="font-medium">
                {fmtAud(deal?.deal_value_aud)}
              </div>

              {/* Last Updated */}
              <div className="text-muted-foreground">{updatedAt}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
