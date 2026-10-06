"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Check, FileText, Loader2, Receipt, Trash2, Upload, X,
} from "lucide-react";
import { deleteInvoice, setInvoicePaid } from "./invoice-actions";

export type InvoiceRow = {
  id:             string;
  invoice_number: string;
  kind:           string;
  issued_on:      string;           // YYYY-MM-DD
  amount_aud:     number | string;
  status:         string;
  paid_on:        string | null;    // YYYY-MM-DD
  file_name:      string;
  notes:          string | null;
};

type Kind = "setup" | "retainer" | "other";

type Draft = {
  invoice_number: string;
  kind:           Kind;
  issued_on:      string;
  amount:         string;
  notes:          string;
  paid:           boolean;
  paid_on:        string;
};

type Hints = {
  readable:     boolean;
  number:       boolean;
  date:         boolean;
  amount:       boolean;
  clientMatch:  boolean | null;
};

const KIND_LABEL: Record<string, string> = { setup: "Setup", retainer: "Retainer", other: "Other" };

const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "2-digit", timeZone: "UTC",
  });
}

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

export function InvoicesSection({
  clientId, clientName, invoices, setupNeeded,
}: {
  clientId:    string;
  clientName:  string;
  invoices:    InvoiceRow[];
  setupNeeded: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [open, setOpen]     = useState(false);
  const [file, setFile]     = useState<File | null>(null);
  const [draft, setDraft]   = useState<Draft | null>(null);
  const [hints, setHints]   = useState<Hints | null>(null);
  const [busy, setBusy]     = useState<"reading" | "saving" | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + Number(i.amount_aud), 0);
  const outstandingTotal = invoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + Number(i.amount_aud), 0);

  function reset() {
    setOpen(false); setFile(null); setDraft(null); setHints(null); setError(null); setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPick(f: File | undefined) {
    if (!f) return;
    setError(null);
    setBusy("reading");
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("client_id", clientId);
      const res = await fetch("/api/invoices/parse", { method: "POST", body: fd });
      const out = await res.json();
      if (!res.ok) {
        setError(out.error ?? "Couldn't read that file.");
        return;
      }
      const p = out.parsed as {
        invoice_number: string | null; issued_on: string | null; amount_aud: number | null;
        kind: Kind; client_match: boolean | null;
      };
      setFile(f);
      setDraft({
        invoice_number: p.invoice_number ?? "",
        kind:           p.kind,
        issued_on:      p.issued_on ?? "",
        amount:         p.amount_aud != null ? String(p.amount_aud) : "",
        notes:          "",
        paid:           false,
        paid_on:        sydneyToday(),
      });
      setHints({
        readable:    Boolean(out.readable),
        number:      p.invoice_number != null,
        date:        p.issued_on != null,
        amount:      p.amount_aud != null,
        clientMatch: p.client_match,
      });
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!file || !draft) return;
    const amount = Number(draft.amount);
    if (!draft.invoice_number.trim())       return setError("Enter the invoice number.");
    if (!draft.issued_on)                   return setError("Enter the issue date.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter the invoice total.");
    if (draft.paid && !draft.paid_on)       return setError("Enter the date it was paid.");

    setError(null);
    setBusy("saving");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("client_id", clientId);
      fd.append("invoice_number", draft.invoice_number.trim());
      fd.append("kind", draft.kind);
      fd.append("issued_on", draft.issued_on);
      fd.append("amount_aud", String(amount));
      fd.append("notes", draft.notes.trim());
      if (draft.paid) fd.append("paid_on", draft.paid_on);

      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const out = await res.json();
      if (!res.ok) {
        setError(out.error ?? "Couldn't save the invoice.");
        return;
      }
      reset();
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Invoices</h2>
          {invoices.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-emerald-600">{money(paidTotal)} paid</span>
              {outstandingTotal > 0 && <> · <span className="font-medium text-amber-600">{money(outstandingTotal)} outstanding</span></>}
            </p>
          )}
        </div>
        {!open && !setupNeeded && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97]"
          >
            <Upload size={12} />
            Upload invoice
          </button>
        )}
      </div>

      {setupNeeded && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Invoices aren&apos;t set up yet — run the invoices migration in Supabase, then refresh this page.</span>
        </div>
      )}

      {/* ── Upload panel ─────────────────────────────────────────────────── */}
      {open && (
        <div className="mb-4 rounded-lg border bg-background p-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {!draft ? (
            <div className="text-center">
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-7 transition-colors hover:bg-muted/30",
                  busy === "reading" && "pointer-events-none opacity-60",
                )}
              >
                {busy === "reading"
                  ? <Loader2 size={22} className="animate-spin text-muted-foreground" />
                  : <Upload size={22} className="text-muted-foreground" />}
                <span className="text-sm font-medium">
                  {busy === "reading" ? "Reading the invoice…" : "Choose the invoice PDF"}
                </span>
                <span className="text-xs text-muted-foreground">PDF, up to 5 MB. We&apos;ll fill in the details for you to check.</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => onPick(e.target.files?.[0])}
                />
              </label>
              <button type="button" onClick={reset} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText size={13} />
                <span className="truncate">{file?.name}</span>
              </div>

              {hints?.clientMatch === false && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>This PDF doesn&apos;t seem to mention {clientName}. Check it&apos;s going on the right client.</span>
                </div>
              )}
              {hints && !hints.readable && (
                <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>Couldn&apos;t read any text from this PDF (it may be a scan). Enter the details below.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Invoice number" miss={hints ? !hints.number : false}>
                  <input className={inputCls} value={draft.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} placeholder="IVORY-NBDS1" />
                </Field>
                <Field label="Type">
                  <select className={inputCls} value={draft.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
                    <option value="setup">Setup (one-off)</option>
                    <option value="retainer">Monthly retainer</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Issue date" miss={hints ? !hints.date : false}>
                  <input type="date" className={inputCls} value={draft.issued_on} onChange={(e) => set("issued_on", e.target.value)} />
                </Field>
                <Field label="Total (AUD)" miss={hints ? !hints.amount : false}>
                  <input type="number" step="0.01" min="0" className={inputCls} value={draft.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1799.00" />
                </Field>
              </div>

              <Field label="Notes (optional)">
                <input className={inputCls} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>

              <div className="rounded-lg border bg-card p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={draft.paid} onChange={(e) => set("paid", e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
                  Already paid
                </label>
                {draft.paid && (
                  <div className="mt-2.5 max-w-[11rem]">
                    <Field label="Date paid">
                      <input type="date" className={inputCls} value={draft.paid_on} onChange={(e) => set("paid_on", e.target.value)} />
                    </Field>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Earnings only count an invoice once it&apos;s paid. You can mark it paid later.
                </p>
              </div>

              {error && <p className="text-xs font-medium text-destructive">{error}</p>}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy === "saving"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Save invoice
                </button>
                <button type="button" onClick={reset} disabled={busy === "saving"} className="rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!draft && error && <p className="mt-3 text-center text-xs font-medium text-destructive">{error}</p>}
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      {invoices.length === 0 ? (
        !open && (
          <div className="rounded-lg border border-dashed bg-background p-5 text-center">
            <Receipt size={22} className="mx-auto opacity-30" />
            <p className="mt-2 text-sm text-muted-foreground">No invoices yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Upload an invoice PDF — once it&apos;s marked paid it counts toward earnings.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <InvoiceItem key={inv.id} inv={inv} clientId={clientId} />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, miss, children }: { label: string; miss?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-foreground/80">
        {label}
        {miss && <span className="ml-1.5 font-normal text-amber-600">couldn&apos;t read — enter it</span>}
      </span>
      {children}
    </label>
  );
}

function InvoiceItem({ inv, clientId }: { inv: InvoiceRow; clientId: string }) {
  const [pending, start]        = useTransition();
  const [marking, setMarking]   = useState(false);
  const [paidOn, setPaidOn]     = useState(sydneyToday());
  const [err, setErr]           = useState<string | null>(null);
  const paid = inv.status === "paid";

  function run(fn: () => Promise<void>) {
    setErr(null);
    start(async () => {
      try { await fn(); } catch { setErr("Something went wrong — try again."); }
    });
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{inv.invoice_number}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {KIND_LABEL[inv.kind] ?? inv.kind}
            </span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              paid ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600",
            )}>
              {paid ? "Paid" : "Outstanding"}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {money(Number(inv.amount_aud))} · Issued {fmtDate(inv.issued_on)}
            {paid && inv.paid_on && <> · Paid {fmtDate(inv.paid_on)}</>}
          </div>
          {inv.notes && <div className="mt-1 text-xs text-muted-foreground">{inv.notes}</div>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={`/api/invoices/${inv.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40"
          >
            <FileText size={12} /> View
          </a>
          {paid ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setInvoicePaid(inv.id, clientId, null))}
              className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            >
              Undo paid
            </button>
          ) : !marking ? (
            <button
              type="button"
              onClick={() => setMarking(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Check size={12} /> Mark paid
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            aria-label={`Delete invoice ${inv.invoice_number}`}
            onClick={() => {
              if (!confirm(`Delete invoice ${inv.invoice_number}? The PDF is removed too.`)) return;
              run(() => deleteInvoice(inv.id, clientId));
            }}
            className="rounded-lg border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>

      {marking && !paid && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3 animate-in fade-in duration-150">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground/80">Date paid</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={cn(inputCls, "w-40")} />
          </label>
          <button
            type="button"
            disabled={pending || !paidOn}
            onClick={() => run(async () => { await setInvoicePaid(inv.id, clientId, paidOn); setMarking(false); })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Confirm
          </button>
          <button type="button" onClick={() => setMarking(false)} className="rounded-lg border px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40">
            <X size={12} />
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-xs font-medium text-destructive">{err}</p>}
    </div>
  );
}
