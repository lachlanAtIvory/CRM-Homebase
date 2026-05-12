"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2, Send, Save, Loader2, UserPlus, Trash2, CalendarDays, Download, AlertCircle } from "lucide-react";
import { saveDraft, submitApplication, type ApplicationInput, type TeamMember } from "./actions";
import { computeCompletion } from "./completion";
import { CompletionRing } from "./completion-ring";

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
  uses_single_calendar: boolean | null;
  team_members:         TeamMember[];
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
  uses_single_calendar: null,
  team_members:        [],
  selected_products: [],
  goals:             "",
  requirements:      "",
};

const EMPTY_MEMBER: TeamMember = {
  name:     "",
  position: "",
  services: "",
};

function fmtAud(v: number) {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function ApplicationForm({ products }: { products: Product[] }) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState<"idle" | "draft" | "submit" | "finalise">("idle");
  const [success, setSuccess] = useState<{ id: string; invoiceSent: boolean } | null>(null);

  // Live completion calculation
  const completion = useMemo(() => computeCompletion(v), [v]);

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

  function addTeamMember() {
    setV((prev) => ({
      ...prev,
      team_members: [...prev.team_members, { ...EMPTY_MEMBER }],
    }));
  }

  function removeTeamMember(idx: number) {
    setV((prev) => ({
      ...prev,
      team_members: prev.team_members.filter((_, i) => i !== idx),
    }));
  }

  function updateTeamMember(idx: number, patch: Partial<TeamMember>) {
    setV((prev) => ({
      ...prev,
      team_members: prev.team_members.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
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

  async function handleFinalise() {
    if (!completion.canFinalise) {
      toast.error("Required fields missing", {
        description: completion.missingRequired.join(", "),
      });
      return;
    }

    setBusy("finalise");
    try {
      // 1. Save draft so DB always reflects latest before export
      await saveDraft(buildPayload());

      // 2. Dynamically import PDF libs (only loaded on first finalise click)
      const [{ pdf }, { ApplicationPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./application-pdf"),
      ]);

      // 3. Build product data with full pricing for the PDF
      const selectedProducts = products
        .filter((p) => v.selected_products.includes(p.key))
        .map((p) => ({
          key:              p.key,
          label:            p.label,
          upfront_cost_aud: p.upfront_cost_aud,
          monthly_cost_aud: p.monthly_cost_aud,
        }));

      const blob = await pdf(
        <ApplicationPDF
          data={{
            company_name:        v.company_name,
            owner_name:          v.owner_name,
            contact_email:       v.contact_email,
            contact_phone:       v.contact_phone,
            abn:                 v.abn,
            trading_address:     v.trading_address,
            uses_single_calendar: v.uses_single_calendar,
            team_members:        v.team_members,
            selected_products:   selectedProducts,
            upfront_total_aud:   upfrontTotal,
            monthly_total_aud:   monthlyTotal,
            goals:               v.goals,
            requirements:        v.requirements,
            generated_at:        new Date().toLocaleDateString("en-AU", {
              day: "numeric", month: "long", year: "numeric",
            }),
          }}
        />,
      ).toBlob();

      // 4. Trigger browser download
      const url   = URL.createObjectURL(blob);
      const slug  = v.company_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const date  = new Date().toISOString().split("T")[0];
      const link  = document.createElement("a");
      link.href     = url;
      link.download = `agent-ivory-application-${slug || "client"}-${date}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Application exported", {
        description: "PDF downloaded — send it to Sassle to start setup.",
      });
    } catch (e) {
      toast.error("Could not generate PDF", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setBusy("idle");
    }
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
      {/* ───────── Completion ring — sticky banner at top ───────── */}
      <div className="sticky top-0 z-20 -mx-2 flex items-center gap-4 rounded-xl border bg-card/95 px-4 py-3 ring-1 ring-foreground/5 backdrop-blur-sm">
        <CompletionRing percent={completion.percent} size={56} label="filled" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {completion.percent === 100
              ? "Application complete"
              : completion.canFinalise
                ? "Ready to finalise"
                : "Application in progress"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {completion.canFinalise
              ? "All required fields are filled — you can finalise & export when ready."
              : `Missing required: ${completion.missingRequired.join(", ")}`}
          </div>
        </div>
      </div>

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

      {/* ───────── Team & Specialists ───────── */}
      <Card title="Team & Specialists">
        <p className="mb-4 text-xs text-muted-foreground">
          Add the people the AI will represent or hand off to. The calendar
          settings tell the developer how to wire bookings.
        </p>

        {/* Single-calendar question */}
        <div className="mb-4 rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium">
            Does the business use one shared calendar?
          </p>
          <div className="flex gap-2">
            <YesNoButton
              active={v.uses_single_calendar === true}
              label="Yes — one shared calendar"
              onClick={() => set("uses_single_calendar", true)}
            />
            <YesNoButton
              active={v.uses_single_calendar === false}
              label="No — separate calendars"
              onClick={() => set("uses_single_calendar", false)}
            />
          </div>
          {v.uses_single_calendar === true && (
            <p className="mt-2 text-xs text-muted-foreground">
              Per-person calendar details are optional — add them below only if any
              team member also has a separate calendar.
            </p>
          )}
          {v.uses_single_calendar === false && (
            <p className="mt-2 text-xs text-muted-foreground">
              For each team member below, indicate whether to integrate their
              calendar into the agent.
            </p>
          )}
        </div>

        {/* Team member list */}
        {v.team_members.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">No team members added yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add specialists, sales staff, or anyone the AI will route calls to.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {v.team_members.map((member, idx) => (
              <TeamMemberCard
                key={idx}
                member={member}
                singleCalendar={v.uses_single_calendar}
                onChange={(patch) => updateTeamMember(idx, patch)}
                onRemove={() => removeTeamMember(idx)}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addTeamMember}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-all duration-150 hover:border-primary/60 hover:bg-primary/10 active:scale-[0.97]"
        >
          <UserPlus size={14} />
          Add team member
        </button>
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

        {/* Finalise & Export — gated on all required fields */}
        <button
          type="button"
          onClick={handleFinalise}
          disabled={busy !== "idle" || !completion.canFinalise}
          title={
            !completion.canFinalise
              ? `Missing: ${completion.missingRequired.join(", ")}`
              : "Generate the developer handoff PDF"
          }
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-all duration-150 active:scale-[0.97]",
            completion.canFinalise && busy === "idle"
              ? "bg-emerald-500 text-white hover:bg-emerald-600 hover:shadow"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
        >
          {busy === "finalise" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : completion.canFinalise ? (
            <Download size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          {busy === "finalise" ? "Generating PDF…" : "Finalise & Export PDF"}
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

function YesNoButton({
  active, label, onClick,
}: {
  active:  boolean;
  label:   string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.97]",
        active
          ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TeamMemberCard({
  member, singleCalendar, onChange, onRemove,
}: {
  member:         TeamMember;
  singleCalendar: boolean | null;
  onChange:       (patch: Partial<TeamMember>) => void;
  onRemove:       () => void;
}) {
  return (
    <div className="rounded-lg border bg-background p-4 ring-1 ring-foreground/5 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Name"
          value={member.name}
          onChange={(s) => onChange({ name: s })}
          placeholder="e.g. Sarah Jones"
        />
        <Field
          label="Position"
          value={member.position}
          onChange={(s) => onChange({ position: s })}
          placeholder="e.g. Lead Specialist"
        />
        <Field
          label="Services Offered"
          value={member.services}
          onChange={(s) => onChange({ services: s })}
          placeholder="e.g. Consults, demos"
        />
      </div>

      {/* Calendar section — depends on top-level single-calendar choice */}
      {singleCalendar !== null && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <CalendarDays size={12} />
            Calendar
          </div>

          {singleCalendar === true ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={member.has_separate_calendar ?? false}
                onChange={(e) => onChange({ has_separate_calendar: e.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
              />
              Also has their own separate calendar
            </label>
          ) : (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Integrate this person&apos;s calendar into the agent?
              </p>
              <div className="flex gap-2">
                <YesNoButton
                  active={member.integrate_calendar === true}
                  label="Yes"
                  onClick={() => onChange({ integrate_calendar: true })}
                />
                <YesNoButton
                  active={member.integrate_calendar === false}
                  label="No"
                  onClick={() => onChange({ integrate_calendar: false })}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Remove team member"
        >
          <Trash2 size={12} />
          Remove
        </button>
      </div>
    </div>
  );
}

function SuccessPanel({ invoiceSent, onNew }: { invoiceSent: boolean; onNew: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center ring-1 ring-foreground/5 animate-in fade-in zoom-in-95 duration-300">
      <div className="mx-auto mb-4 flex h-14 w-14 animate-in zoom-in-50 duration-500 items-center justify-center rounded-full bg-primary/10 text-primary ring-4 ring-primary/5">
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
