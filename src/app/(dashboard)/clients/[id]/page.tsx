import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "./client-form";
import { TasksSection } from "./tasks-section";

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

  // Three separate queries — avoids any embedded-join schema-cache issues
  const [
    { data: client },
    { data: deals },
    { data: tasks },
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
    </div>
  );
}
