import Link from "next/link";
import { FileText, Rocket, AlertCircle, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { DeleteApplicationListRowButton } from "./delete-application-row-button";

const STATUS_STYLES: Record<string, string> = {
  draft:     "bg-muted text-muted-foreground",
  submitted: "bg-emerald-500/10 text-emerald-600",
  invoiced:  "bg-primary/10 text-primary",
  paid:      "bg-emerald-500/20 text-emerald-700",
};

function fmtAud(v: number | null | undefined) {
  if (!v) return "—";
  return `$${v.toLocaleString("en-AU")}`;
}

export default async function ApplicationsPage() {
  const supabase = await createClient();

  // Separate queries — avoids any embedded-join schema-cache issues
  const [{ data: apps }, { data: clients }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, company_name, contact_email, status, selected_products, upfront_total_aud, client_id, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("clients")
      .select("id, company_name"),
  ]);

  const clientNameById = new Map(
    (clients ?? []).map((c) => [c.id as string, c.company_name as string]),
  );

  // Count by status for the summary chips at the top
  const appRows = apps ?? [];
  const counts = appRows.reduce(
    (acc, a) => {
      const status = (a.status as string) ?? "draft";
      acc[status] = (acc[status] ?? 0) + 1;
      acc.total++;
      return acc;
    },
    { total: 0 } as Record<string, number>,
  );

  return (
    <div className="space-y-5">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every application across every client, sorted by most recently
            updated. Click a row to open and edit.
          </p>
        </div>
        <Link
          href="/application/new"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20 active:scale-[0.96]"
        >
          <Rocket
            size={13}
            className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:rotate-12"
          />
          New Application
        </Link>
      </div>

      {/* ── Status chips ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Chip label="Total" value={counts.total ?? 0} tone="neutral" />
        <Chip label="Draft" value={counts.draft ?? 0} tone="muted" />
        <Chip label="Submitted" value={counts.submitted ?? 0} tone="success" />
        <Chip label="Invoiced" value={counts.invoiced ?? 0} tone="primary" />
        <Chip label="Paid" value={counts.paid ?? 0} tone="success" />
      </div>

      {/* ── List ─────────────────────────────────────────────────────────── */}
      {appRows.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center ring-1 ring-foreground/5">
          <FileText size={32} className="mx-auto opacity-30" />
          <h2 className="mt-3 text-sm font-semibold">No applications yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Hit Launch Application above to start one.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/5">
          {/* Column header — pr-12 reserves the same space the rows give the
              trash button so the columns align */}
          <div className="grid grid-cols-12 gap-3 border-b bg-muted/30 px-4 py-2.5 pr-12 text-xs font-medium text-muted-foreground">
            <div className="col-span-3">Company</div>
            <div className="col-span-3">Contact</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Linked Client</div>
            <div className="col-span-1 text-right">Setup</div>
            <div className="col-span-1 text-right">Updated</div>
          </div>

          {/* Rows */}
          <div className="divide-y">
            {appRows.map((a) => {
              const id            = a.id as string;
              const status        = (a.status as string) ?? "draft";
              const productCount  = Array.isArray(a.selected_products)
                ? a.selected_products.length
                : 0;
              const total         = Number(a.upfront_total_aud) || 0;
              const clientId      = a.client_id as string | null;
              const clientName    = clientId ? clientNameById.get(clientId) : null;
              const updated       = a.updated_at
                ? new Date(a.updated_at as string).toLocaleDateString("en-AU", {
                    day: "numeric", month: "short", year: "2-digit",
                  })
                : "—";

              return (
                <div
                  key={id}
                  className="group relative transition-all duration-150 hover:bg-muted/50 hover:shadow-[inset_3px_0_0_0_var(--primary)] active:bg-muted/70"
                >
                  {/* Big invisible Link covering the row except the trash zone */}
                  <Link
                    href={`/application/${id}`}
                    aria-label={`Open application for ${a.company_name ?? "untitled"}`}
                    className="absolute inset-y-0 left-0 right-10"
                  />

                  {/* Data grid — same columns as header, same pr-12 reserves
                      space for the absolute trash button on the right */}
                  <div className="grid grid-cols-12 items-center gap-3 px-4 py-3 pr-12 text-sm">
                    {/* Company */}
                    <div className="col-span-3 flex min-w-0 items-center gap-2 font-medium">
                      <FileText size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {(a.company_name as string) || "Untitled"}
                      </span>
                    </div>

                    {/* Contact */}
                    <div className="col-span-3 min-w-0 truncate text-xs text-muted-foreground">
                      {(a.contact_email as string) || "—"}
                    </div>

                    {/* Status */}
                    <div className="col-span-2 min-w-0">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                          STATUS_STYLES[status] ?? STATUS_STYLES.draft,
                        )}
                      >
                        {status}
                      </span>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {productCount} product{productCount === 1 ? "" : "s"}
                      </div>
                    </div>

                    {/* Linked Client */}
                    <div className="col-span-2 min-w-0 text-xs">
                      {clientName ? (
                        <span className="block truncate text-muted-foreground">
                          {clientName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          <AlertCircle size={9} />
                          Orphan
                        </span>
                      )}
                    </div>

                    {/* Setup */}
                    <div className="col-span-1 text-right text-xs font-medium text-primary">
                      {fmtAud(total)}
                    </div>

                    {/* Updated */}
                    <div className="col-span-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">{updated}</span>
                      <ArrowRight
                        size={12}
                        className="opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-primary group-hover:opacity-100"
                      />
                    </div>
                  </div>

                  {/* Trash button — absolutely positioned on the far right,
                      outside the data grid and the Link's click area */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <DeleteApplicationListRowButton
                      applicationId={id}
                      label={(a.company_name as string) || "this application"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Stat chip — coloured pill with a number + label
// ───────────────────────────────────────────────────────────────────────────
function Chip({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone:  "neutral" | "muted" | "success" | "primary";
}) {
  const toneClasses = {
    neutral: "bg-card ring-foreground/10 text-foreground",
    muted:   "bg-card ring-foreground/5 text-muted-foreground",
    success: "bg-emerald-500/5 ring-emerald-500/20 text-emerald-700",
    primary: "bg-primary/5 ring-primary/20 text-primary",
  }[tone];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-0 px-3 py-1.5 text-xs ring-1 transition-all",
        toneClasses,
      )}
    >
      <span className="font-bold tabular-nums">{value}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}
