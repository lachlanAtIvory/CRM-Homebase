"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type Deal = {
  current_stage: string | null;
  deal_value_aud: number | null;
  updated_at: string | null;
};

type ClientRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  deals: Deal | Deal[] | null;
};

export function ClientsTable({
  clients,
  overdueClientIds,
}: {
  clients: ClientRow[];
  overdueClientIds: string[];
}) {
  const router = useRouter();
  const overdueSet = new Set(overdueClientIds);

  if (clients.length === 0) {
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
            <TableRow>
              <td
                colSpan={5}
                className="py-16 text-center text-sm text-muted-foreground"
              >
                No clients yet — data syncs from your Google Sheet via n8n.
              </td>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

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
          {clients.map((client) => {
            const deals     = Array.isArray(client.deals) ? client.deals : client.deals ? [client.deals] : [];
            const deal      = deals[0];
            const overdue   = overdueSet.has(client.id);
            const updatedAt = deal?.updated_at
              ? new Date(deal.updated_at).toLocaleDateString("en-AU", {
                  day: "numeric", month: "short", year: "2-digit",
                })
              : "—";

            return (
              <TableRow
                key={client.id}
                className="cursor-pointer"
                onClick={() => router.push(`/clients/${client.id}`)}
              >
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    {overdue && (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
                        title="Overdue task"
                      />
                    )}
                    {client.company_name}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {client.contact_name ?? "—"}
                </TableCell>
                <TableCell>
                  {deal?.current_stage ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {STAGE_LABELS[deal.current_stage] ?? deal.current_stage}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>{fmtAud(deal?.deal_value_aud)}</TableCell>
                <TableCell className="text-muted-foreground">{updatedAt}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
