"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2, Send, Save, Loader2 } from "lucide-react";
import { saveDraft, submitApplication, type ApplicationInput } from "./actions";

type Product = {
  key:              string;
  label:            string;
  description:      string;
  upfront_cost_aud: number;
  monthly_cost_aud: number;
};

type FormValues = {
  company_name:     string;
  owner_name:       string;
  contact_email:    string;
  contact_phone:    string;
  abn:              string;
  trading_address:  string;
  selected_products: string[];
  goals:            string;
  requirements:     string;
};

const EMPTY: FormValues = {
  company_name:      "",
  owner_name:        "",
  contact_email:     "",
  contact_phone:     "",
  abn:               "",
  trading_address:   "",
  selected_products: [],
  goals:             "",
  requirements:      "",
};

function fmtAud(v: number) {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function ApplicationForm({ products }: { products: Product[] }) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState<"idle" | "draft" | "submit">("idle");
  const [success, setSuccess] = useState<{ id: string; invoiceSent: boolean } | null>(null);

  // Live quote totals
  const { upfrontTotal, monthlyTotal } = useMemo(() => {
    let upfront = 0;
    let monthly = 0;
    for (const p of products) {
      if (v.selected_products.includes(p.key)) {
        upfront += p.upfront_cost_aud;
        monthly += p.monthly_cost_aud;
      }
    }
    return { upfrontTotal: upfront, monthlyTotal: monthly };
  }, [v.selected_products, products]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  function toggleProduct(key: string) {
    setV((prev) => ({
      ...prev,
      selected_products: prev.selected_products.includes(key)
        ? prev.selected_products.filter((k) => k !== key)
        : [...prev.selected_products, key],
    }));
  }

  function buildPayload(): ApplicationInput {
    return {
      ...v,
      upfront_total_aud: upfrontTotal,
      monthly_total_aud: monthlyTotal,
    };
  }

  async function handleSaveDraft() {
    setBusy("draft");
    const promise = saveDraft(buildPayload());

    toast.promise(promise, {
      loading: "Saving draft…",
      success: (r) => (r.ok ? "Draft saved" : ""),
      error:   "Something went wrong saving the draft.",
    });

    const result = await promise;
    setBusy("idle");
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSuccess({ id: result.application_id, invoiceSent: false });
  }

  async function handleSubmit() {
    setBusy("submit");
    const promise = submitApplication(buildPayload());

    toast.promise(promise, {
      loading: "Submitting application and sending invoice…",
      success: (r) =>
        r.ok
          ? r.invoice_sent
            ? "✨ Application submitted — invoice emailed to client"
            : "Application saved — invoice email failed (check Resend setup)"
          : "",
      error: "Something went wrong submitting the application.",
    });

    const result = await promise;
    setBusy("idle");
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSuccess({ id: result.application_id, invoiceSent: result.invoice_sent });
    router.refresh();
  }

  if (success) {
    return (
      <SuccessPanel
        invoiceSent={success.invoiceSent}
        onNew={() => {
          setSuccess(null);
          setV(EMPTY);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ───────── Client Details ───────── */}
      <Card title="Client Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company Name *"
            value={v.company_name}
            onChange={(s) => set("company_name", s)}
            placeholder="e.g. Acme Pty Ltd"
          />
          <Field
            label="Owner Name"
            value={v.owner_name}
            onChange={(s) => set("owner_name", s)}
            placeholder="e.g. Jane Smith"
          />
          <Field
            label="Contact Email"
            value={v.contact_email}
            onChange={(s) => set("contact_email", s)}
            type="email"
            placeholder="jane@acme.com.au"
          />
          <Field
            label="Phone"
            value={v.contact_phone}
            onChange={(s) => set("contact_phone", s)}
            type="tel"
            placeholder="0412 345 678"
          />
        </div>
      </Card>

      {/* ───────── Business Details ───────── */}
      <Card title="Business Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="ABN"
            value={v.abn}
            onChange={(s) => set("abn", s)}
            placeholder="11 digits"
          />
          <Field
            label="Trading Address"
            value={v.trading_address}
            onChange={(s) => set("trading_address", s)}
            placeholder="Street, suburb, state, postcode"
          />
        </div>
      </Card>

      {/* ───────── Product Details ───────── */}
      <Card title="Product Details">
        <p className="mb-4 text-xs text-muted-foreground">
          Tick the products this client is signing up for. The quote on the right
          updates automatically.
        </p>
        <div className="space-y-2">
          {products.map((p) => {
            const active = v.selected_products.includes(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => toggleProduct(p.key)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-all duration-150 active:scale-[0.99]",
                  active
                    ? "border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/20"
                    : "border-border bg-background hover:border-foreground/20 hover:bg-muted/30",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background",
                    )}
                  >
                    {active && <CheckCircle2 size={14} />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.label}</div>
                    {p.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{p.description}</div>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-semibold text-foreground">
                    {fmtAud(p.upfront_cost_aud)}
                  </div>
                  <div className="text-muted-foreground">
                    + {fmtAud(p.monthly_cost_aud)}/mo
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Live quote */}
        <div className="mt-5 rounded-lg border bg-muted/30 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Quote Summary
          </div>
          <div className="space-y-1.5">
            <Row label="Upfront setup total" value={fmtAud(upfrontTotal)} />
            <Row label="Monthly retainer total" value={`${fmtAud(monthlyTotal)} / month`} />
            <Row
              label="GST (10%) on setup"
              value={fmtAud(upfrontTotal * 0.1)}
              dim
            />
            <div className="my-2 border-t" />
            <Row
              label="Total payable now (inc. GST)"
              value={fmtAud(upfrontTotal * 1.1)}
              strong
            />
          </div>
        </div>
      </Card>

      {/* ───────── Goals & Requirements ───────── */}
      <Card title="Goals & Requirements">
        <div className="space-y-4">
          <Textarea
            label="Goals"
            value={v.goals}
            onChange={(s) => set("goals", s)}
            placeholder="What outcome is this client trying to achieve?"
          />
          <Textarea
            label="Requirements"
            value={v.requirements}
            onChange={(s) => set("requirements", s)}
            placeholder="Specific integrations, constraints, deadlines…"
          />
        </div>
      </Card>

      {/* ───────── Actions ───────── */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={busy !== "idle" || !v.company_name.trim()}
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {busy === "draft" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {busy === "draft" ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy !== "idle" || !v.company_name.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {busy === "submit" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          {busy === "submit" ? "Submitting…" : "Submit & Send Invoice"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Tiny presentational helpers
// ───────────────────────────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
      />
    </div>
  );
}

function Textarea({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
      />
    </div>
  );
}

function Row({
  label, value, dim, strong,
}: {
  label: string;
  value: string;
  dim?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn(
        dim    ? "text-xs text-muted-foreground" : "text-muted-foreground",
        strong && "font-semibold text-foreground",
      )}>
        {label}
      </span>
      <span className={cn(
        dim    ? "text-xs text-muted-foreground" : "text-foreground",
        strong && "font-semibold",
      )}>
        {value}
      </span>
    </div>
  );
}

function SuccessPanel({ invoiceSent, onNew }: { invoiceSent: boolean; onNew: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center ring-1 ring-foreground/5 animate-in fade-in zoom-in-95 duration-300">
      <div className="mx-auto mb-4 flex h-14 w-14 animate-in zoom-in-50 duration-500 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-4 ring-emerald-500/5">
        <CheckCircle2 size={28} />
      </div>
      <h2 className="text-lg font-semibold">Application saved</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {invoiceSent
          ? "The invoice has been emailed to the client and they've been added to your CRM."
          : "Saved as draft — no invoice has been sent yet."}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97]"
        >
          New Application
        </button>
        <a
          href="/clients"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.97]"
        >
          View Clients
        </a>
      </div>
    </div>
  );
}
