import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { fetchEarnings } from "@/lib/hq/earnings";

const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
  });
}

/**
 * Earnings table — paid vs outstanding per client, with headline totals.
 * Fed by uploaded client invoices (cash basis: counted once marked paid).
 */
export async function EarningsTableWidget({ className }: { className?: string }) {
  const supabase = await createClient();
  const e = await fetchEarnings(supabase);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Earnings</CardTitle>
        <p className="text-xs text-muted-foreground">From uploaded invoices · AUD · counted once marked paid</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Paid this month" value={money(e.paidThisMonth)} tone="good" />
          <Stat label="Paid all time" value={money(e.paidAllTime)} />
          <Stat label="Outstanding" value={money(e.outstanding)} tone={e.outstanding > 0 ? "warn" : undefined} />
        </div>

        {e.byClient.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invoices yet. Open a client and upload one under Invoices.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Client</th>
                  <th className="pb-2 text-right font-medium">Paid</th>
                  <th className="pb-2 text-right font-medium">Outstanding</th>
                  <th className="pb-2 text-right font-medium">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {e.byClient.map((r) => (
                  <tr key={r.clientId} className="border-b last:border-0">
                    <td className="py-2.5 pr-3">
                      <Link href={`/clients/${r.clientId}`} className="font-medium hover:text-primary hover:underline">
                        {r.clientName}
                      </Link>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{money(r.paid)}</td>
                    <td className={`py-2.5 text-right tabular-nums ${r.outstanding > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {money(r.outstanding)}
                    </td>
                    <td className="py-2.5 text-right text-muted-foreground">
                      {r.lastPaidOn ? fmtDate(r.lastPaidOn) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
