"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircle2, Send, Save, Loader2, UserPlus, Trash2, CalendarDays, Download, AlertCircle, Briefcase, Plus, CalendarClock, Calculator } from "lucide-react";
import { findOffering, offeringGroups } from "@/lib/hq/offerings";
import { money } from "@/lib/hq/quote-math";
import type { QuoteSnapshot } from "@/lib/hq/quote-to-application";
import { formatSydney } from "@/lib/hq/sydney-time";
import { saveDraft, submitApplication, type ApplicationInput, type TeamMember, type Service } from "./actions";
import { computeCompletion } from "./completion";
import { CompletionRing } from "./completion-ring";
import { calcQuote } from "./pricing";

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
  services:             Service[];
  uses_single_calendar: boolean | null;
  team_members:         TeamMember[];
  booking_platform_name:  string;
  booking_platform_url:   string;
  booking_platform_notes: string;
  selected_products: string[];
  discount_percent:  number;
  discount_reason:   string;
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
  services:          [],
  uses_single_calendar: null,
  team_members:        [],
  booking_platform_name:  "",
  booking_platform_url:   "",
  booking_platform_notes: "",
  selected_products: [],
  discount_percent:  0,
  discount_reason:   "",
  goals:             "",
  requirements:      "",
};

const EMPTY_MEMBER: TeamMember = {
  name:           "",
  position:       "",
  service_ids:    [],
  other_services: "",
};

function newServiceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `svc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function fmtAud(v: number) {
  return `$${v.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function ApplicationForm({
  legacyProducts,
  initialValues,
  applicationId: initialApplicationId,
  clientId,
  quote,
  quotePushedAt,
}: {
  /** Old-catalogue products (priced) selected on an application made before the new offerings. */
  legacyProducts: Product[];
  initialValues?: Partial<FormValues>;
  applicationId?: string;
  /** The CRM client this application is for. */
  clientId?: string;
  /** The quote pushed to this application from the Quote Builder, if any. */
  quote?: QuoteSnapshot | null;
  quotePushedAt?: string | null;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({ ...EMPTY, ...(initialValues ?? {}) });
  // applicationId is tracked in state so once we INSERT the first time,
  // subsequent saves UPDATE the same row instead of creating duplicates.
  const [applicationId, setApplicationId] = useState<string | undefined>(initialApplicationId);
  const [busy, setBusy] = useState<"idle" | "draft" | "submit" | "finalise">("idle");
  const [success, setSuccess] = useState<{ id: string } | null>(null);

  // Live completion calculation
  const completion = useMemo(() => computeCompletion(v), [v]);

  // The price comes from the quote when one was pushed. An old application priced from the
  // old catalogue keeps its own numbers.
  const legacySelected = useMemo(
    () => legacyProducts.filter((p) => v.selected_products.includes(p.key)),
    [legacyProducts, v.selected_products],
  );
  const { upfrontTotal, monthlyTotal } = useMemo(() => {
    if (quote) {
      return {
        upfrontTotal: Math.round(quote.summary.setupTotal * 100) / 100,
        monthlyTotal: Math.round(quote.summary.monthlyTotal * 100) / 100,
      };
    }
    let upfront = 0;
    let monthly = 0;
    for (const p of legacySelected) {
      upfront += p.upfront_cost_aud;
      monthly += p.monthly_cost_aud;
    }
    return { upfrontTotal: upfront, monthlyTotal: monthly };
  }, [quote, legacySelected]);

  // Old-style breakdown (discount + GST), only shown for old catalogue-priced applications
  const legacyQuote = useMemo(
    () => calcQuote(upfrontTotal, monthlyTotal, v.discount_percent),
    [upfrontTotal, monthlyTotal, v.discount_percent],
  );

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

  function addService() {
    setV((prev) => ({
      ...prev,
      services: [...prev.services, { id: newServiceId(), name: "" }],
    }));
  }

  function updateService(idx: number, name: string) {
    setV((prev) => ({
      ...prev,
      services: prev.services.map((s, i) => (i === idx ? { ...s, name } : s)),
    }));
  }

  function removeService(idx: number) {
    setV((prev) => {
      const removed = prev.services[idx];
      const removedId = removed?.id;
      return {
        ...prev,
        services: prev.services.filter((_, i) => i !== idx),
        // Cascade: also strip this service id from every team member
        team_members: prev.team_members.map((m) => ({
          ...m,
          service_ids: (m.service_ids ?? []).filter((id) => id !== removedId),
        })),
      };
    });
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
      application_id:    applicationId,
      client_id:         clientId,
      upfront_total_aud: upfrontTotal,
      monthly_total_aud: monthlyTotal,
    };
  }

  async function handleSaveDraft() {
    setBusy("draft");
    const promise = saveDraft(buildPayload());

    toast.promise(promise, {
      loading: "Saving draft…",
      success: (r) => {
        if (!r.ok) return "";
        if (r.merged) return "✦ Merged into existing application for this client";
        if (applicationId) return "Draft updated";
        return "Draft saved";
      },
      error:   "Something went wrong saving the draft.",
    });

    const result = await promise;
    setBusy("idle");
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // Capture the id so future saves UPDATE the same row.
    // Bump the URL when the row id differs from what we were editing —
    // either because we just inserted a new row OR because the dedup logic
    // pointed us at a pre-existing row for this client.
    if (result.application_id !== applicationId) {
      setApplicationId(result.application_id);
      try {
        window.history.replaceState({}, "", `/application/${result.application_id}`);
      } catch { /* noop */ }
    }
  }

  async function handleSubmit() {
    setBusy("submit");
    const promise = submitApplication(buildPayload());

    toast.promise(promise, {
      loading: "Submitting application…",
      success: (r) => (r.ok ? "✨ Application submitted" : ""),
      error: "Something went wrong submitting the application.",
    });

    const result = await promise;
    setBusy("idle");
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setApplicationId(result.application_id);
    setSuccess({ id: result.application_id });
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
      const selectedProducts = v.selected_products.map((key) => {
        const legacy = legacyProducts.find((p) => p.key === key);
        return {
          key,
          label:            findOffering(key)?.label ?? legacy?.label ?? key,
          upfront_cost_aud: legacy?.upfront_cost_aud ?? 0,
          monthly_cost_aud: legacy?.monthly_cost_aud ?? 0,
        };
      });

      const blob = await pdf(
        <ApplicationPDF
          data={{
            company_name:           v.company_name,
            owner_name:             v.owner_name,
            contact_email:          v.contact_email,
            contact_phone:          v.contact_phone,
            abn:                    v.abn,
            trading_address:        v.trading_address,
            services:               v.services,
            uses_single_calendar:   v.uses_single_calendar,
            team_members:           v.team_members,
            booking_platform_name:  v.booking_platform_name,
            booking_platform_url:   v.booking_platform_url,
            booking_platform_notes: v.booking_platform_notes,
            selected_products:      selectedProducts,
            quote:                  quote ? {
              setup_total:      quote.summary.setupTotal,
              monthly_total:    quote.summary.monthlyTotal,
              gst_shown:        quote.summary.gst,
              term:             quote.summary.term,
              tier_label:       quote.summary.tierLabel,
              clinic_type:      quote.summary.clinicTypeLabel,
              setup_lines:      quote.summary.setup,
              monthly_lines:    quote.summary.monthly,
            } : null,
            upfront_total_aud:      upfrontTotal,
            monthly_total_aud:      monthlyTotal,
            discount_percent:       v.discount_percent,
            discount_reason:        v.discount_reason,
            goals:                  v.goals,
            requirements:           v.requirements,
            generated_at:           new Date().toLocaleDateString("en-AU", {
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
        applicationId={success.id}
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

      {/* ───────── Services ───────── */}
      <Card title="Services">
        <p className="mb-4 text-xs text-muted-foreground">
          List every service the business offers. You&apos;ll assign these to team
          members in the next section.
        </p>

        {v.services.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background p-5 text-center">
            <Briefcase size={22} className="mx-auto opacity-30" />
            <p className="mt-2 text-sm text-muted-foreground">No services added yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              e.g. Consultation, Discovery Call, Treatment, Onboarding…
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {v.services.map((svc, idx) => (
              <div
                key={svc.id}
                className="flex items-center gap-2 rounded-lg border bg-background p-2 animate-in fade-in slide-in-from-top-1 duration-200"
              >
                <input
                  type="text"
                  value={svc.name}
                  onChange={(e) => updateService(idx, e.target.value)}
                  placeholder="Service name…"
                  className="min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 py-1 text-sm outline-none focus:bg-background focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={() => removeService(idx)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remove service"
                  aria-label="Remove service"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addService}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-all duration-150 hover:border-primary/60 hover:bg-primary/10 active:scale-[0.97]"
        >
          <Plus size={14} />
          Add service
        </button>
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
                services={v.services}
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

      {/* ───────── Booking Platform ───────── */}
      <Card title="Booking Platform">
        <p className="mb-4 flex items-start gap-2 text-xs text-muted-foreground">
          <CalendarClock size={14} className="mt-0.5 shrink-0" />
          <span>
            Which booking system does the client currently use? Helps the developer
            plan calendar sync, port-over, or replace.
          </span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Platform name"
            value={v.booking_platform_name}
            onChange={(s) => set("booking_platform_name", s)}
            placeholder="e.g. Calendly, Acuity, Fresha, Square…"
          />
          <Field
            label="Account URL"
            value={v.booking_platform_url}
            onChange={(s) => set("booking_platform_url", s)}
            placeholder="e.g. calendly.com/acme"
            type="url"
          />
        </div>
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Notes
          </label>
          <textarea
            value={v.booking_platform_notes}
            onChange={(e) => set("booking_platform_notes", e.target.value)}
            placeholder="Anything Sassle should know — login plan, integrations, what to keep / replace…"
            rows={3}
            className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
        </div>
      </Card>

      {/* ───────── Products ───────── */}
      <Card title="Products">
        {quote ? (
          <QuotePanel quote={quote} pushedAt={quotePushedAt ?? null} clientId={clientId} />
        ) : (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              No quote has been pushed here. Build it in the Quote Builder and push it across to fill in
              the products and price, or tick the products by hand.
            </p>
            <Link
              href={clientId ? `/quote?client=${clientId}` : "/quote"}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97]"
            >
              <Calculator size={13} /> Open Quote Builder
            </Link>
          </div>
        )}

        {offeringGroups().map((g) => (
          <div key={g.group} className="mb-4 last:mb-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</div>
            <div className="space-y-2">
              {g.items.map((o) => (
                <ProductRow
                  key={o.key}
                  label={o.label}
                  description={o.desc}
                  active={v.selected_products.includes(o.key)}
                  onToggle={() => toggleProduct(o.key)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* An application made under the old catalogue keeps its products and prices */}
        {legacyProducts.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Chosen under the old catalogue</div>
            <p className="mb-2 text-xs text-muted-foreground">These were picked before the new offerings. Untick any that no longer apply.</p>
            <div className="space-y-2">
              {legacyProducts.map((p) => (
                <ProductRow
                  key={p.key}
                  label={p.label}
                  description={p.description}
                  active={v.selected_products.includes(p.key)}
                  onToggle={() => toggleProduct(p.key)}
                  right={
                    <div className="text-right text-xs">
                      <div className="font-semibold text-foreground">{fmtAud(p.upfront_cost_aud)}</div>
                      <div className="text-muted-foreground">+ {fmtAud(p.monthly_cost_aud)}/mo</div>
                    </div>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Old-style discount + summary: only for an application priced from the old catalogue */}
        {!quote && legacySelected.length > 0 && (
          <>
            <div className="mt-5 rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Discount
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Applies to both the upfront setup and the monthly retainer.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={v.discount_percent === 0 ? "" : v.discount_percent}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set("discount_percent", isNaN(n) ? 0 : Math.max(0, Math.min(100, n)));
                    }}
                    placeholder="0"
                    className="w-20 rounded-md border bg-background px-2 py-1.5 text-right text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  />
                  <span className="text-sm font-semibold text-muted-foreground">%</span>
                </div>
              </div>
              {v.discount_percent > 0 && (
                <input
                  type="text"
                  value={v.discount_reason}
                  onChange={(e) => set("discount_reason", e.target.value)}
                  placeholder="Reason (e.g. Friends & family, loyalty, launch promo)"
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs outline-none ring-1 ring-transparent focus:ring-primary/40"
                />
              )}
            </div>

            <div className="mt-3 rounded-lg border bg-muted/30 p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quote Summary
              </div>
              <div className="space-y-1.5">
                <Row label="Upfront setup subtotal" value={fmtAud(upfrontTotal)} />
                <Row label="Monthly retainer subtotal" value={`${fmtAud(monthlyTotal)} / month`} />
                {v.discount_percent > 0 && (
                  <>
                    <div className="my-1 border-t border-dashed" />
                    <Row
                      label={`Discount (${v.discount_percent}% off setup)`}
                      value={`−${fmtAud(legacyQuote.discount_upfront_amount)}`}
                      accent
                    />
                    <Row
                      label={`Discount (${v.discount_percent}% off monthly)`}
                      value={`−${fmtAud(legacyQuote.discount_monthly_amount)} / month`}
                      accent
                    />
                    <Row label="Setup after discount" value={fmtAud(legacyQuote.upfront_after_discount)} />
                    <Row label="Monthly after discount" value={`${fmtAud(legacyQuote.monthly_after_discount)} / month`} />
                  </>
                )}
                <Row label="GST (10%) on setup" value={fmtAud(legacyQuote.gst_amount)} dim />
                <div className="my-2 border-t" />
                <Row label="Total payable now (inc. GST)" value={fmtAud(legacyQuote.total_payable_now)} strong />
              </div>
            </div>
          </>
        )}
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
          {busy === "submit" ? "Submitting…" : "Submit Application"}
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
  label, value, dim, strong, accent,
}: {
  label:   string;
  value:   string;
  dim?:    boolean;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn(
        dim    ? "text-xs text-muted-foreground" : "text-muted-foreground",
        strong && "font-semibold text-foreground",
        accent && "font-medium text-primary",
      )}>
        {label}
      </span>
      <span className={cn(
        dim    ? "text-xs text-muted-foreground" : "text-foreground",
        strong && "font-semibold",
        accent && "font-medium text-primary",
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
  member, services, singleCalendar, onChange, onRemove,
}: {
  member:         TeamMember;
  services:       Service[];
  singleCalendar: boolean | null;
  onChange:       (patch: Partial<TeamMember>) => void;
  onRemove:       () => void;
}) {
  const selectedIds = member.service_ids ?? [];

  function toggleService(id: string) {
    onChange({
      service_ids: selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    });
  }

  return (
    <div className="rounded-lg border bg-background p-4 ring-1 ring-foreground/5 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      {/* Services this member performs — chips from the Services list above */}
      <div className="mt-3">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Services performed
        </label>
        {services.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Add services to the Services section above to assign them here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {services
              .filter((s) => s.name.trim().length > 0)
              .map((svc) => {
                const active = selectedIds.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggleService(svc.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.95]",
                      active
                        ? "border-primary/50 bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {svc.name}
                  </button>
                );
              })}
          </div>
        )}
        <div className="mt-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            Other services (free-text)
          </label>
          <input
            type="text"
            value={member.other_services ?? ""}
            onChange={(e) => onChange({ other_services: e.target.value })}
            placeholder="e.g. Custom consultations, training…"
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
        </div>
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

function SuccessPanel({ applicationId, onNew }: { applicationId: string; onNew: () => void }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center ring-1 ring-foreground/5 animate-in fade-in zoom-in-95 duration-300">
      <div className="mx-auto mb-4 flex h-14 w-14 animate-in zoom-in-50 duration-500 items-center justify-center rounded-full bg-primary/10 text-primary ring-4 ring-primary/5">
        <CheckCircle2 size={28} />
      </div>
      <h2 className="text-lg font-semibold">Application submitted</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        It&apos;s saved against the client and their deal is marked as quoted. No invoice is sent from here.
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
          href={`/application/${applicationId}`}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-muted/40 active:scale-[0.97]"
        >
          Back to Application
        </a>
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

function ProductRow({ label, description, active, onToggle, right }: {
  label: string; description: string; active: boolean; onToggle: () => void; right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-4 rounded-lg border p-3.5 text-left transition-all duration-150 active:scale-[0.99]",
        active
          ? "border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/20"
          : "border-border bg-background hover:border-foreground/20 hover:bg-muted/30",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
          )}
        >
          {active && <CheckCircle2 size={14} />}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{label}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
      </div>
      {right}
    </button>
  );
}

/** What the quote said, kept with the application: who the clinic is, what they pay, how it was priced. */
function QuotePanel({ quote, pushedAt, clientId }: { quote: QuoteSnapshot; pushedAt: string | null; clientId?: string }) {
  const q = quote.summary;
  const factor = q.gst ? 1.1 : 1;
  const gstNote = q.gst ? "inc GST" : "ex GST";
  return (
    <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-primary">From the quote</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pushedAt ? `Pushed ${formatSydney(pushedAt)}. ` : ""}
            Pushing again from the Quote Builder replaces the products and price below.
          </p>
        </div>
        <Link
          href={clientId ? `/quote?client=${clientId}` : "/quote"}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97]"
        >
          <Calculator size={13} /> Open quote
        </Link>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Clinic</dt><dd className="text-right font-medium">{q.clinicTypeLabel}, {q.practitioners} practitioner{q.practitioners === 1 ? "" : "s"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Size</dt><dd className="text-right font-medium">{q.tierLabel} tier, {q.band === "high" ? "high-value" : "standard"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Practice software</dt><dd className="text-right font-medium">{q.pms.name || "Not named"}, {q.pms.integrates ? "books into it" : "team confirms bookings"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Term</dt><dd className="text-right font-medium">{q.term === "12" ? "12 months" : "Month to month"}</dd></div>
        {q.locations.length > 0 && (
          <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Extra locations</dt><dd className="text-right font-medium">{q.locations.map((l) => `${l.name} (${l.practitioners})`).join(", ")}</dd></div>
        )}
        {q.offers.length > 0 && (
          <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Ad offers</dt><dd className="text-right font-medium">{q.offers.map((o) => o.name || o.kindLabel).join(", ")}</dd></div>
        )}
        {q.core.some((c) => c.status === "live") && (
          <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-muted-foreground">Already live</dt><dd className="text-right font-medium">{q.core.filter((c) => c.status === "live").map((c) => c.label).join(", ")}</dd></div>
        )}
      </dl>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border bg-background p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Setup (one-off)</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums">{money(q.setupTotal * factor)}</div>
          <div className="text-[11px] text-muted-foreground">{gstNote}</div>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums">{money(q.monthlyTotal * factor)}</div>
          <div className="text-[11px] text-muted-foreground">{gstNote}</div>
        </div>
      </div>

      {(q.setup.length > 0 || q.monthly.length > 0) && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none font-medium text-primary">See how it&apos;s priced</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {([["Setup", q.setup], ["Monthly", q.monthly]] as const).map(([title, lines]) => (
              <div key={title}>
                <div className="mb-1 font-semibold">{title}</div>
                <ul className="space-y-0.5">
                  {lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{l.label}</span>
                      <span className={cn("tabular-nums", l.neg && "text-emerald-700 dark:text-emerald-300")}>{money(l.amt * factor)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {q.flags.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-300">
          {q.flags.map((f, i) => <li key={i} className="flex gap-1.5"><AlertCircle size={13} className="mt-0.5 shrink-0" />{f}</li>)}
        </ul>
      )}
    </div>
  );
}
