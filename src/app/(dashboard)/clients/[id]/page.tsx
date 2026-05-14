import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Rocket, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "./client-form";
import { TasksSection } from "./tasks-section";
import { DeleteApplicationButton, DeleteClientButton } from "./delete-buttons";

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

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Four separate queries — avoids any embedded-join schema-cache issues
  const [
    { data: client },
    { data: deals },
    { data: tasks },
    { data: applications },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, contact_name, phone, email, notes, website, active_tools")
      .eq("id", id)
      .single(),
    supabase
      .from("deals")
      .select("current_stage, deal_value_aud, updated_at")
      .eq("client_id", id)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("tasks")
      .select("id, title, due_date, due_time, completed_at, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("applications")
      .select("id, status, selected_products, upfront_total_aud, updated_at")
      .eq("client_id", id)
      .order("updated_at", { ascending: false }),
  ]);

  if (!client) notFound();

  const deal = Array.isArray(deals) ? deals[0] ?? null : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back link */}
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        Back to Clients
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{client.company_name}</h1>
        {client.contact_name && (
          <p className="mt-0.5 text-sm text-muted-foreground">{client.contact_name}</p>
        )}
      </div>

      {/* Deal status pill */}
      {deal?.current_stage && (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {STAGE_LABELS[deal.current_stage] ?? deal.current_stage}
          </span>
          {deal.deal_value_aud && (
            <span className="text-sm font-semibold text-primary">
              ${deal.deal_value_aud.toLocaleString("en-AU")} AUD
            </span>
          )}
        </div>
      )}

      {/* Applications */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Applications</h2>
          <Link
            href="/application/new"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97]"
          >
            <Rocket size={12} />
            New
          </Link>
        </div>

        {!applications || applications.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background p-5 text-center">
            <FileText size={22} className="mx-auto opacity-30" />
            <p className="mt-2 text-sm text-muted-foreground">No applications yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Submit one via Launch Application — it will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {applications.map((a) => {
              const productCount = Array.isArray(a.selected_products) ? a.selected_products.length : 0;
              const total        = Number(a.upfront_total_aud) || 0;
              const updated      = a.updated_at
                ? new Date(a.updated_at as string).toLocaleDateString("en-AU", {
                    day: "numeric", month: "short", year: "2-digit",
                  })
                : "—";
              return (
                <div
                  key={a.id as string}
                  className="group flex items-center gap-2 rounded-lg border bg-background pr-2 transition-all duration-150 hover:border-foreground/15 hover:bg-muted/30"
                >
                  <Link
                    href={`/application/${a.id}`}
                    className="flex flex-1 items-center justify-between gap-3 p-3 active:scale-[0.99]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-muted-foreground" />
                        <span className="text-sm font-medium">
                          Application
                        </span>
                        <span className={
                          a.status === "invoiced"  ? "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                        : a.status === "submitted" ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600"
                                                   : "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        }>
                          {(a.status as string) ?? "draft"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {productCount} product{productCount === 1 ? "" : "s"}
                        {total > 0 && <> · ${total.toLocaleString("en-AU")} setup</>}
                        <> · Updated {updated}</>
                      </div>
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                  <DeleteApplicationButton
                    applicationId={a.id as string}
                    clientId={client.id}
                    label={`${productCount} product${productCount === 1 ? "" : "s"}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Editable form */}
      <ClientForm
        id={client.id}
        initialValues={{
          contact_name:  client.contact_name  ?? "",
          phone:         (client as any).phone        ?? "",
          email:         (client as any).email        ?? "",
          website:       (client as any).website      ?? "",
          notes:         (client as any).notes        ?? "",
          active_tools:  (client as any).active_tools ?? [],
        }}
      />

      {/* Tasks */}
      <TasksSection
        clientId={client.id}
        initialTasks={tasks ?? []}
      />

      {/* Danger zone — last on the page, behind a confirm prompt */}
      <DeleteClientButton
        clientId={client.id}
        clientName={client.company_name}
      />
    </div>
  );
}
