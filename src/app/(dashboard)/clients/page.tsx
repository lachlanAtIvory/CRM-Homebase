import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ClientsPage() {
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
