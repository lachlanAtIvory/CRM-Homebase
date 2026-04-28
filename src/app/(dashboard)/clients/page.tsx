import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name, contact_name, deals(current_stage, deal_value_aud, updated_at)")
    .order("created_at", { ascending: false });

  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Deal Value</TableHead>
            <TableHead>Last Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!clients || clients.length === 0 ? (
            <TableRow>
              <td
                colSpan={5}
                className="py-16 text-center text-sm text-muted-foreground"
              >
                No clients yet — data syncs from your Google Sheet via n8n.
              </td>
            </TableRow>
          ) : (
            clients.map((client) => {
              const deals = Array.isArray(client.deals) ? client.deals : [];
              const deal = deals[0];
              const updatedAt = deal?.updated_at
                ? new Date(deal.updated_at).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "2-digit",
                  })
                : "—";

              return (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">
                    {client.company_name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {client.contact_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {deal?.current_stage ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {STAGE_LABELS[deal.current_stage] ?? deal.current_stage}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{fmtAud(deal?.deal_value_aud)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {updatedAt}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
