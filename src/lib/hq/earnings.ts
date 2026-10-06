import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Earnings — computed from uploaded client invoices.
 *
 * Cash basis: an invoice counts as earnings only once it's marked PAID,
 * in the month it was paid (paid_on). Invoices not yet paid are reported
 * separately as outstanding. This replaces the old Revenue chart, which
 * estimated from deal values rather than real money.
 */

export type EarningsMonth = { month: string; revenue: number };

export type EarningsClientRow = {
  clientId:    string;
  clientName:  string;
  paid:        number;
  outstanding: number;
  lastPaidOn:  string | null;   // YYYY-MM-DD
};

export type EarningsSummary = {
  paidThisMonth: number;
  paidAllTime:   number;
  outstanding:   number;
  byMonth:       EarningsMonth[];        // chronological, months with payments only
  byClient:      EarningsClientRow[];    // biggest earners first
};

const EMPTY: EarningsSummary = {
  paidThisMonth: 0, paidAllTime: 0, outstanding: 0, byMonth: [], byClient: [],
};

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "short", year: "2-digit", timeZone: "UTC",
  });
}

export async function fetchEarnings(supabase: SupabaseClient): Promise<EarningsSummary> {
  const { data: invoices, error } = await supabase
    .from("client_invoices")
    .select("client_id, amount_aud, status, paid_on")
    .limit(5000);

  // Table missing (migration not run yet) or nothing uploaded: empty, not a crash.
  if (error || !invoices || invoices.length === 0) return EMPTY;

  const thisMonth = sydneyToday().slice(0, 7);
  const monthTotals = new Map<string, number>();
  const perClient = new Map<string, EarningsClientRow>();
  let paidThisMonth = 0, paidAllTime = 0, outstanding = 0;

  for (const inv of invoices) {
    const amount = Number(inv.amount_aud) || 0;
    const clientId = inv.client_id as string;
    const row = perClient.get(clientId) ?? {
      clientId, clientName: "", paid: 0, outstanding: 0, lastPaidOn: null,
    };

    if (inv.status === "paid" && inv.paid_on) {
      const paidOn = inv.paid_on as string;
      const ym = paidOn.slice(0, 7);
      monthTotals.set(ym, (monthTotals.get(ym) ?? 0) + amount);
      paidAllTime += amount;
      if (ym === thisMonth) paidThisMonth += amount;
      row.paid += amount;
      if (!row.lastPaidOn || paidOn > row.lastPaidOn) row.lastPaidOn = paidOn;
    } else {
      outstanding += amount;
      row.outstanding += amount;
    }
    perClient.set(clientId, row);
  }

  // Client names — separate query, matching the repo's no-embedded-joins habit
  const ids = [...perClient.keys()];
  const { data: clients } = await supabase.from("clients").select("id, company_name").in("id", ids);
  for (const c of clients ?? []) {
    const row = perClient.get(c.id as string);
    if (row) row.clientName = (c.company_name as string) ?? "Unknown client";
  }

  const byMonth = [...monthTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, revenue]) => ({ month: monthLabel(ym), revenue }));

  const byClient = [...perClient.values()]
    .map((r) => ({ ...r, clientName: r.clientName || "Unknown client" }))
    .sort((a, b) => b.paid - a.paid || b.outstanding - a.outstanding);

  return { paidThisMonth, paidAllTime, outstanding, byMonth, byClient };
}
