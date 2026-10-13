"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN, CLINIC_TYPES, CORE, CORE_ORDER, defaultState, DRAFT_KEY, FEES, MAX_SETUP_DISCOUNT_PCT, newId, OFFER_KIND, QuoteState,
  restoreState, SAVED_KEY, SETUP, TIER_LABEL, UPSELLS, Upsell,
} from "@/lib/hq/quote-config";
import {
  computeQuote, gstFactor, gstLabel, Line, money, num, quoteText,
  tierOf, upsellAvailable, upsellMonthly,
} from "@/lib/hq/quote-math";
import { Check, Copy, Eye, EyeOff, FilePlus, Plus, Save, Trash2, X } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   Browser storage — drafts and saved quotes live in this browser only.
──────────────────────────────────────────────────────────────────────────── */
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function readSaved(): Record<string, unknown> {
  const v = readJson(SAVED_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Counts toward its target whenever the target moves (interruptible). Jumps
 * straight to the target when the tab is hidden (browsers pause animation
 * frames there, which would leave a stale price) or reduced motion is on.
 */
function useCountUp(target: number, duration = 450): number {
  const [display, setDisplay] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    if (from === target) return;
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      shown.current = from + (target - from) * (1 - Math.pow(1 - p, 3));
      setDisplay(shown.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

/* ────────────────────────────────────────────────────────────────────────────
   Page component
──────────────────────────────────────────────────────────────────────────── */
export function QuoteBuilder() {
  const [state, setState] = useState<QuoteState>(defaultState);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<Record<string, unknown>>({});
  const [clientView, setClientView] = useState(false);
  const [status, setStatus] = useState("");
  const [delArmed, setDelArmed] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const delTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Restore the draft and saved quotes after mount (localStorage isn't there during SSR).
  useEffect(() => {
    const draft = readJson(DRAFT_KEY);
    if (draft) setState(restoreState(draft));
    setSaved(readSaved());
    setReady(true);
    return () => { clearTimeout(statusTimer.current); clearTimeout(delTimer.current); };
  }, []);

  // Keep the working draft so a refresh doesn't lose a quote mid-call.
  useEffect(() => {
    if (ready) writeJson(DRAFT_KEY, state);
  }, [state, ready]);

  const r = useMemo(() => computeQuote(state), [state]);
  const g = gstFactor(state);
  const tierName = TIER_LABEL[r.tier];
  const clinicName = state.clinic.trim();
  const savedNames = Object.keys(saved).sort((a, b) => a.localeCompare(b));
  const hasSaved = clinicName !== "" && clinicName in saved;
  const internal = !clientView;

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 2600);
  }, []);

  /** Apply a change to a copy of the state. */
  const edit = useCallback((fn: (d: QuoteState) => void) => {
    setState((prev) => { const next = structuredClone(prev); fn(next); return next; });
  }, []);

  function disarmDelete() {
    clearTimeout(delTimer.current);
    setDelArmed(false);
  }

  function saveQuote() {
    if (!clinicName) { flash("Add the clinic name to save this quote"); return; }
    const next = { ...readSaved(), [clinicName]: structuredClone(state) };
    if (writeJson(SAVED_KEY, next)) { setSaved(next); flash(`Saved ${clinicName}`); }
    else flash("Saving isn't available in this browser");
  }

  function deleteQuote() {
    if (!delArmed) {
      setDelArmed(true);
      clearTimeout(delTimer.current);
      delTimer.current = setTimeout(() => setDelArmed(false), 3500);
      return;
    }
    disarmDelete();
    const next = readSaved();
    delete next[clinicName];
    if (writeJson(SAVED_KEY, next)) { setSaved(next); flash(`Deleted ${clinicName}`); }
    else flash("Couldn't delete: browser storage is blocked");
  }

  function openQuote(name: string) {
    if (!name || !(name in saved)) return;
    disarmDelete();
    setState(restoreState(saved[name]));
    flash(`Opened ${name}. Mark their current products as already live to quote add-ons.`);
  }

  function newQuote() {
    const unsaved = clinicName !== "" &&
      JSON.stringify(restoreState(saved[clinicName])) !== JSON.stringify(state);
    if (unsaved && !window.confirm(`Start a new quote? "${clinicName}" has changes that aren't saved.`)) return;
    disarmDelete();
    setState(defaultState());
    flash("New quote started");
  }

  async function copyQuote() {
    const text = quoteText(state, r);
    try {
      await navigator.clipboard.writeText(text);
      flash("Quote copied");
      return;
    } catch { /* fall through to the older copy path */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); flash("Quote copied"); }
    catch { flash("Copy didn't work. Select the quote and copy it manually."); }
    document.body.removeChild(ta);
  }

  const setupShown = useCountUp(r.setupTotal * g);
  const monthlyShown = useCountUp(r.monthlyTotal * g);

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Agent Ivory speed to lead. Fill it in on the call and the quote builds itself.
          </p>
          {internal && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Quotes save in this browser only. Prices exclude GST unless you switch it on in Terms.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {internal && (
            <>
              <select
                aria-label="Open a saved quote"
                value=""
                onChange={(e) => openQuote(e.target.value)}
                className={cn(inputCls, "w-auto py-1.5 text-xs")}
              >
                <option value="">{savedNames.length ? "Open a saved quote" : "No saved quotes yet"}</option>
                {savedNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button type="button" onClick={saveQuote} className={btnCls}>
                <Save size={13} /> Save quote
              </button>
              {hasSaved && (
                <button
                  type="button"
                  onClick={deleteQuote}
                  className={cn(btnCls, delArmed && "border-destructive text-destructive")}
                >
                  <Trash2 size={13} /> {delArmed ? "Click again to delete" : "Delete saved quote"}
                </button>
              )}
              <button type="button" onClick={newQuote} className={btnCls}>
                <FilePlus size={13} /> New quote
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={clientView}
            onClick={() => setClientView((v) => !v)}
            className={cn(btnCls, clientView ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "")}
          >
            {clientView ? <EyeOff size={13} /> : <Eye size={13} />}
            {clientView ? "Back to builder view" : "Client view"}
          </button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* ── Left: the build ─────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* 1 — The clinic */}
          <Card step={1} title="The clinic" sub="These answers set the size tier and value band.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Clinic name">
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. Neutral Bay Dental Surgery"
                  value={state.clinic}
                  onChange={(e) => { const v = e.target.value; edit((d) => { d.clinic = v; }); }}
                />
              </Field>
              <Field label="Clinic type">
                <select
                  className={inputCls}
                  value={state.type}
                  onChange={(e) => { const v = e.target.value as QuoteState["type"]; edit((d) => { d.type = v; }); }}
                >
                  {CLINIC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Practitioners at the main location">
                <input
                  type="number" min={1} step={1}
                  className={inputCls}
                  value={state.practitioners}
                  onChange={(e) => { const v = e.target.value; edit((d) => { d.practitioners = v; }); }}
                />
              </Field>
              {internal && (
                <Field label="Size tier">
                  <select
                    className={inputCls}
                    value={state.tierOverride}
                    onChange={(e) => { const v = e.target.value as QuoteState["tierOverride"]; edit((d) => { d.tierOverride = v; }); }}
                  >
                    <option value="auto">Set by practitioners</option>
                    <option value="solo">Solo</option>
                    <option value="practice">Practice</option>
                    <option value="group">Group</option>
                  </select>
                </Field>
              )}
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-foreground/80">
                  Can Ivory connect to their practice software?
                </span>
                <Seg
                  name="pms"
                  label="Can Ivory connect to their practice software?"
                  value={state.pms}
                  onChange={(v) => edit((d) => { d.pms = v; })}
                  options={[
                    { value: "yes", label: "Yes, it has an API" },
                    { value: "no", label: "No, team confirms bookings" },
                  ]}
                />
              </div>
              <Field label="Practice software">
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. Dentally, Cliniko"
                  value={state.pmsName}
                  onChange={(e) => { const v = e.target.value; edit((d) => { d.pmsName = v; }); }}
                />
              </Field>
              <Field label="New leads a month">
                <input
                  type="number" min={0}
                  className={inputCls}
                  placeholder="Rough number"
                  value={state.leads}
                  onChange={(e) => { const v = e.target.value; edit((d) => { d.leads = v; }); }}
                />
              </Field>
              {internal && (
                <div className="sm:col-span-2">
                  <Field label="Notes for the build">
                    <textarea
                      className={cn(inputCls, "min-h-[72px] resize-y")}
                      placeholder="Services Ivory must know, what always goes to a human, coverage hours"
                      value={state.notes}
                      onChange={(e) => { const v = e.target.value; edit((d) => { d.notes = v; }); }}
                    />
                  </Field>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill>{tierName} tier</Pill>
              <Pill>{r.band === "high" ? "High-value" : "Standard"} band</Pill>
              <Pill>{r.integrates ? "Books into the PMS" : "Handoff, 20% off"}</Pill>
            </div>
          </Card>

          {/* 2 — Core products */}
          <Card
            step={2}
            title="Core products"
            sub="How do their ad enquiries come in? Every extra product is half price to set up. Mark products they already have as live."
          >
            <div className="divide-y">
              {CORE_ORDER.map((p) => {
                const c = state.core[p];
                return (
                  <div key={p} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold">{CORE[p].label}</h3>
                        <p className="text-xs text-muted-foreground">{CORE[p].desc}</p>
                        <p className="mt-1 text-xs font-semibold">
                          {money(SETUP[r.tier])} setup, {money(CORE[p].monthly[r.band][r.tier])} a month
                          {p === "outbound" ? " plus booking fees" : ""}
                        </p>
                      </div>
                      <Seg
                        name={`core-${p}`}
                        label={CORE[p].label}
                        value={c.state}
                        onChange={(v) => edit((d) => { d.core[p].state = v; })}
                        options={[
                          { value: "off", label: "Not included" },
                          { value: "new", label: "Add" },
                          ...(internal || c.state === "live" ? [{ value: "live" as const, label: "Already live" }] : []),
                        ]}
                      />
                    </div>

                    {internal && c.state === "live" && (
                      <div className="mt-3">
                        <Field label="Current monthly price, if on old pricing ($)">
                          <input
                            type="number" min={0}
                            className={inputCls}
                            placeholder="Leave blank to use new pricing"
                            value={c.legacy}
                            onChange={(e) => { const v = e.target.value; edit((d) => { d.core[p].legacy = v; }); }}
                          />
                        </Field>
                      </div>
                    )}

                    {p === "outbound" && c.state !== "off" && (
                      <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 text-xs font-bold">Ad offers and booking fees</div>
                        {state.offers.length === 0 && (
                          <p className="mb-2 text-xs text-muted-foreground">Add the offer their ads promote.</p>
                        )}
                        <div className="space-y-2">
                          {state.offers.map((o) => (
                            <div key={o.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_auto_auto]">
                              <input
                                type="text"
                                aria-label="Offer name"
                                className={inputCls}
                                placeholder="e.g. Invisalign consult"
                                value={o.name}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  edit((d) => { const row = d.offers.find((x) => x.id === o.id); if (row) row.name = v; });
                                }}
                              />
                              <select
                                aria-label="Offer type"
                                className={inputCls}
                                value={o.kind}
                                onChange={(e) => {
                                  const v = e.target.value as keyof typeof OFFER_KIND;
                                  edit((d) => { const row = d.offers.find((x) => x.id === o.id); if (row) row.kind = v; });
                                }}
                              >
                                {Object.entries(OFFER_KIND).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                              </select>
                              <span className="whitespace-nowrap text-[13px] font-bold">
                                {money(FEES[state.pms][o.kind])}{" "}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {r.integrates ? "per attended booking" : "per qualified handoff"}
                                </span>
                              </span>
                              <button
                                type="button"
                                aria-label="Remove offer"
                                onClick={() => edit((d) => { d.offers = d.offers.filter((x) => x.id !== o.id); })}
                                className={cn(btnCls, "justify-center")}
                              >
                                <X size={13} /> Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => { const id = newId(); edit((d) => { d.offers.push({ id, name: "", kind: "low" }); }); }}
                          className={cn(btnCls, "mt-2")}
                        >
                          <Plus size={13} /> Add an offer
                        </button>
                        <div className="mt-3">
                          <Field label="Monthly cap on booking fees (optional, $)">
                            <input
                              type="number" min={0}
                              className={inputCls}
                              placeholder="No cap"
                              value={state.cap}
                              onChange={(e) => { const v = e.target.value; edit((d) => { d.cap = v; }); }}
                            />
                          </Field>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 3 — Extra locations */}
          <Card
            step={3}
            title="Extra locations"
            sub="Each location is priced by its own size: half price setup and 75% of the monthly. It gets the same core products as the main location."
          >
            {state.locations.length === 0 && (
              <p className="mb-3 text-xs text-muted-foreground">Single location. Add one if they run more than one site.</p>
            )}
            <div className="space-y-2">
              {state.locations.map((l) => (
                <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1.6fr)_110px_auto_auto]">
                  <input
                    type="text"
                    aria-label="Location name"
                    className={inputCls}
                    placeholder="e.g. Mosman"
                    value={l.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      edit((d) => { const row = d.locations.find((x) => x.id === l.id); if (row) row.name = v; });
                    }}
                  />
                  <input
                    type="number" min={1}
                    aria-label="Practitioners"
                    className={inputCls}
                    placeholder="Practitioners"
                    value={l.practitioners}
                    onChange={(e) => {
                      const v = e.target.value;
                      edit((d) => { const row = d.locations.find((x) => x.id === l.id); if (row) row.practitioners = v; });
                    }}
                  />
                  <Pill>{TIER_LABEL[tierOf(l.practitioners)]}</Pill>
                  <button
                    type="button"
                    aria-label="Remove location"
                    onClick={() => edit((d) => { d.locations = d.locations.filter((x) => x.id !== l.id); })}
                    className={cn(btnCls, "justify-center")}
                  >
                    <X size={13} /> Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { const id = newId(); edit((d) => { d.locations.push({ id, name: "", practitioners: "2" }); }); }}
              className={cn(btnCls, "mt-3")}
            >
              <Plus size={13} /> Add a location
            </button>
          </Card>

          {/* 4 — Upsells */}
          <Card
            step={4}
            title="Upsells"
            sub="Best offered after go-live, with their own 90-day numbers. Priced by the main location's tier. Only options that suit this clinic are shown."
          >
            <UpsellList state={state} r={r} edit={edit} internal={internal} />
          </Card>

          {/* 5 — Terms */}
          <Card step={5} title="Terms" sub="Discounts only in exchange for something.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Term</span>
                <Seg
                  name="term"
                  label="Term"
                  value={state.term}
                  onChange={(v) => edit((d) => { d.term = v; })}
                  options={[
                    { value: "m2m", label: "Month to month" },
                    { value: "12", label: "12 months" },
                  ]}
                />
              </div>
              <Field label="In exchange for">
                <select
                  className={inputCls}
                  value={state.discountReason}
                  onChange={(e) => { const v = e.target.value as QuoteState["discountReason"]; edit((d) => { d.discountReason = v; }); }}
                >
                  <option value="none">Nothing, no discount</option>
                  <option value="term">A 12-month term</option>
                  <option value="upfront">Upfront payment</option>
                  <option value="casestudy">Case study rights</option>
                </select>
              </Field>
              <Field label="Setup discount (%)">
                <input
                  type="number" min={0} max={MAX_SETUP_DISCOUNT_PCT} step={1}
                  className={inputCls}
                  value={state.discountPct}
                  onChange={(e) => { const v = e.target.value; edit((d) => { d.discountPct = v; }); }}
                />
              </Field>
              <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={state.spread}
                  onChange={(e) => { const v = e.target.checked; edit((d) => { d.spread = v; }); }}
                />
                Spread setup over 3 monthly payments
              </label>
              <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={state.gst}
                  onChange={(e) => { const v = e.target.checked; edit((d) => { d.gst = v; }); }}
                />
                Show prices including GST
              </label>
            </div>
          </Card>

          {/* 6 — Return assumptions (internal) */}
          {internal && (
            <Card
              step={6}
              title="Return assumptions"
              sub="Keep these conservative. Defaults: about one recovered appointment a day for a Solo clinic, scaled up by size and extra channels. Use their real numbers when you have them."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Recovered appointments a month"
                  action={<ResetLink onClick={() => edit((d) => { d.apptOverride = ""; })} />}
                >
                  <input
                    type="number" min={0}
                    className={inputCls}
                    placeholder={`${r.defAppts} (default)`}
                    value={state.apptOverride}
                    onChange={(e) => { const v = e.target.value; edit((d) => { d.apptOverride = v; }); }}
                  />
                </Field>
                <Field
                  label="Value per appointment ($)"
                  action={<ResetLink onClick={() => edit((d) => { d.valueOverride = ""; })} />}
                >
                  <input
                    type="number" min={0}
                    className={inputCls}
                    placeholder={`${r.defValue} (default)`}
                    value={state.valueOverride}
                    onChange={(e) => { const v = e.target.value; edit((d) => { d.valueOverride = v; }); }}
                  />
                </Field>
              </div>
            </Card>
          )}
        </div>

        {/* ── Right: the quote (sticky) ───────────────────────────────────── */}
        <aside className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:rounded-2xl">
          <div className="overflow-hidden rounded-2xl border bg-card ring-1 ring-foreground/5">
            <div
              className={cn(
                "px-5 pb-4 pt-5 text-white transition-colors duration-300",
                !(r.count && r.monthlyTotal > 0) || r.ret >= 10
                  ? "bg-primary text-primary-foreground"
                  : r.ret >= 5 ? "bg-amber-700" : "bg-red-700",
              )}
            >
              <p className="mb-1.5 text-[13px] opacity-90">
                {clinicName ? `Agent Ivory for ${clinicName}` : "Your Agent Ivory build"}
              </p>
              {r.count && r.monthlyTotal > 0 ? (
                <>
                  <div className="text-[56px] font-bold leading-none tracking-tight tabular-nums">
                    {r.ret.toFixed(1)}x
                    <span className="ml-1.5 text-[20px] font-medium tracking-normal">return each month</span>
                  </div>
                  <p className="mt-2 text-[13px] opacity-90">
                    About {money(r.value)} a month recovered from {r.appts} appointments at {money(r.per)}.
                    {r.payback ? ` Setup pays for itself in about ${r.payback} days.` : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-[56px] font-bold leading-none">&nbsp;</div>
                  <p className="mt-2 text-[13px] opacity-90">Pick a core product to see the return.</p>
                </>
              )}
            </div>

            <div className="px-5 pb-5 pt-4">
              <div className="grid grid-cols-2 gap-3 border-b pb-3.5">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Setup, one-off</div>
                  <div className="text-[28px] font-bold leading-tight tracking-tight tabular-nums">
                    {money(setupShown)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {state.spread && r.setupTotal > 0
                      ? `or 3 payments of ${money(r.setupTotal * g / 3)}`
                      : gstLabel(state)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Monthly</div>
                  <div className="text-[28px] font-bold leading-tight tracking-tight tabular-nums">
                    {money(monthlyShown)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {state.term === "12" ? "12-month term, " : "Month to month, "}{gstLabel(state)}
                  </div>
                </div>
              </div>

              {r.setup.length > 0 && (
                <>
                  <RHead>Setup</RHead>
                  <LineList lines={r.setup} g={g} />
                </>
              )}
              {r.monthly.length > 0 && (
                <>
                  <RHead>Monthly</RHead>
                  <LineList lines={r.monthly} g={g} />
                </>
              )}
              {r.fees.length > 0 && (
                <>
                  <RHead>
                    {r.integrates
                      ? "Booking fees, per attended booking"
                      : "Handoff fees, per qualified lead passed to your team"}
                  </RHead>
                  <LineList
                    lines={r.fees}
                    g={g}
                    footer={num(state.cap) > 0 ? { label: "Monthly cap on these fees", amt: num(state.cap) } : undefined}
                  />
                </>
              )}
              {r.runs.length > 0 && (
                <>
                  <RHead>Campaigns, billed per run</RHead>
                  <LineList lines={r.runs} g={g} />
                </>
              )}

              <p className="mt-3.5 border-t pt-3 text-[13px] text-muted-foreground">
                Included: unlimited usage (fair use applies) and a monthly results report.
                {r.integrates ? "" : " Your team confirms bookings that Ivory qualifies."}
              </p>

              {internal && r.flags.map((f) => (
                <div
                  key={f}
                  className="mt-2.5 rounded-lg bg-amber-500/15 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-300"
                >
                  {f}
                </div>
              ))}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={copyQuote}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97]"
                >
                  <Copy size={13} /> Copy quote
                </button>
                <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
                  {status.startsWith("Quote copied") && <Check size={12} className="text-emerald-600" />}
                  {status}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Upsells
──────────────────────────────────────────────────────────────────────────── */
function UpsellList({ state, r, edit, internal }: {
  state: QuoteState;
  r: ReturnType<typeof computeQuote>;
  edit: (fn: (d: QuoteState) => void) => void;
  internal: boolean;
}) {
  const available = UPSELLS.filter((u) => upsellAvailable(u, state));
  const hidden = UPSELLS.length - available.length;
  const groups: { id: Upsell["group"]; title: string }[] = [
    { id: "rev", title: "Revenue upsells" },
    { id: "eff", title: "Efficiency upsells" },
  ];

  return (
    <div>
      {groups.map(({ id, title }) => {
        const items = available.filter((u) => u.group === id);
        if (!items.length) return null;
        return (
          <div key={id} className="[&:not(:first-child)]:mt-4">
            <div className="mb-1 text-sm font-bold">{title}</div>
            <div className="divide-y">
              {items.map((u) => {
                const on = state.upsells[u.id] === true;
                const csv = u.id === "recall" && !r.integrates;
                let cost: React.ReactNode;
                if (u.id === "reactivation") {
                  cost = <>{money(CAMPAIGN.reactivation.perContact, 2)} per contact<br />{money(CAMPAIGN.reactivation.minimum)} minimum a run</>;
                } else if (csv) {
                  cost = <>CSV campaign<br />{money(CAMPAIGN.recall.perContact, 2)} per contact, {money(CAMPAIGN.recall.minimum)} min</>;
                } else {
                  cost = <>{money(u.setup ?? 0)} setup<br />{money(upsellMonthly(u, r.tier, r.band))} a month</>;
                }
                const contactsKey = u.id === "reactivation" ? "reactivationContacts" : csv ? "recallContacts" : null;
                return (
                  <label key={u.id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={on}
                      onChange={(e) => {
                        const v = e.target.checked;
                        edit((d) => { if (v) d.upsells[u.id] = true; else delete d.upsells[u.id]; });
                      }}
                    />
                    <span>
                      <span className="text-sm font-semibold">{u.name}</span>
                      <br />
                      <span className="text-xs text-muted-foreground">{u.desc}</span>
                    </span>
                    <span className="whitespace-nowrap text-right text-xs font-semibold">{cost}</span>
                    {contactsKey && on && (
                      <span className="col-start-2 col-end-4 flex items-center gap-2 text-xs text-muted-foreground">
                        {u.id === "reactivation" ? "Contacts in the list" : "Contacts in the CSV"}
                        <input
                          type="number" min={0}
                          aria-label={u.id === "reactivation" ? "Contacts in the list" : "Contacts in the CSV"}
                          className={cn(inputCls, "w-28 py-1.5")}
                          value={state[contactsKey]}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { const v = e.target.value; edit((d) => { d[contactsKey] = v; }); }}
                        />
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {internal && hidden > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {hidden} hidden because they don&apos;t suit this clinic type{r.integrates ? "" : " or need PMS access"}.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Small building blocks
──────────────────────────────────────────────────────────────────────────── */
const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97]";

function Card({ step, title, sub, children }: {
  step: number; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="flex items-start gap-2.5 border-b px-5 py-3.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[13px] font-bold text-primary">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold text-foreground/80">
        {label}
        {action}
      </span>
      {children}
    </label>
  );
}

function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className="text-xs font-semibold text-primary hover:underline"
    >
      Reset
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
      {children}
    </span>
  );
}

/** Pill-shaped radio group built on real radio inputs, so keyboard use works. */
function Seg<T extends string>({ name, label, value, options, onChange }: {
  name: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-full border bg-background p-[3px]">
      {options.map((o) => (
        <label key={o.value} className="relative block">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="block whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

function RHead({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-3.5 text-sm font-bold">{children}</div>;
}

function LineList({ lines, g, footer }: {
  lines: Line[];
  g: number;
  footer?: { label: string; amt: number };
}) {
  return (
    <ul className="m-0 list-none p-0">
      {lines.map((l, i) => (
        <li key={`${l.label}-${i}`} className="flex justify-between gap-3 py-[3px] text-[13px]">
          <span>{l.label}</span>
          <span className={cn("whitespace-nowrap tabular-nums", l.neg && "text-emerald-600")}>
            {money(l.amt * g)}
          </span>
        </li>
      ))}
      {footer && (
        <li className="flex justify-between gap-3 py-[3px] text-[13px]">
          <span>{footer.label}</span>
          <span className="whitespace-nowrap tabular-nums">{money(footer.amt * g)}</span>
        </li>
      )}
    </ul>
  );
}
