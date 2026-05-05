import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STAGE_CONFIG = [
  { key: "call_booked",   label: "Call Booked"   },
  { key: "document_sent", label: "Document Sent" },
  { key: "quoted",        label: "Quoted"        },
  { key: "approved",      label: "Approved"      },
  { key: "onboarding",    label: "Setting Up"    },
  { key: "final_testing", label: "Final Testing" },
  { key: "activated",     label: "Activated"     },
  { key: "live_client",   label: "Live Client"   },
] as const;

function fmtAud(v: number | null | undefined) {
  if (!v) return null;
  return `$${v.toLocaleString("en-AU")}`;
}

function hasOverdueTasks(tasks: { due_date: string | null; completed_at: string | null }[]) {
  const today = new Date().toISOString().split("T")[0];
  return tasks.some((t) => !t.completed_at && t.due_date && t.due_date < today);
}

export default async function PipelinePage() {
  const supabase = await createClient();

  const { data: deals } = await supabase
    .from("deals")
    .select(`
      id, current_stage, deal_value_aud, updated_at,
      clients(id, company_name, contact_name, tasks(due_date, completed_at))
    `)
    .not("current_stage", "in", '("closed_lost","paused")')
    .order("updated_at", { ascending: false });

  // Group deals by stage
  const byStage: Record<string, NonNullable<typeof deals>> = {};
  for (const { key } of STAGE_CONFIG) byStage[key] = [];
  for (const deal of deals ?? []) {
    if (deal.current_stage in byStage) byStage[deal.current_stage].push(deal);
  }

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-3 pb-4" style={{ minWidth: `${STAGE_CONFIG.length * 220}px` }}>
        {STAGE_CONFIG.map(({ key, label }) => {
          const col = byStage[key] ?? [];
          return (
            <div
              key={key}
              className="flex w-52 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3 ring-1 ring-foreground/5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <span className="text-xs text-muted-foreground">{col.length}</span>
              </div>

              <div className="flex min-h-16 flex-col gap-2">
                {col.length === 0 ? (
                  <div className="flex-1 rounded-lg border-2 border-dashed border-border/50 p-4" />
                ) : (
                  col.map((deal) => {
                    const client = Array.isArray(deal.clients)
                      ? deal.clients[0]
                      : deal.clients;
                    const tasks   = Array.isArray((client as any)?.tasks)
                      ? (client as any).tasks
                      : [];
                    const overdue = hasOverdueTasks(tasks);
                    const value   = fmtAud(deal.deal_value_aud);
                    const clientId = (client as any)?.id;

                    const card = (
                      <div className="rounded-lg border bg-background p-3 shadow-sm transition-colors hover:bg-muted/40">
                        <div className="flex items-start gap-2">
                          {overdue && (
                            <span
                              className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
                              title="Overdue task"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight">
                              {client?.company_name ?? "—"}
                            </p>
                            {client?.contact_name && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {client.contact_name}
                              </p>
                            )}
                            {value && (
                              <p className="mt-1.5 text-xs font-semibold text-emerald-600">
                                {value}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );

                    return clientId ? (
                      <Link key={deal.id} href={`/clients/${clientId}`}>
                        {card}
                      </Link>
                    ) : (
                      <div key={deal.id}>{card}</div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
