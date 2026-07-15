"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Assumptions, BIZ_LABELS, BizType, BUNDLES, DEFAULTS, FLAT_MODS, LS_KEY,
  MOD_ORDER, ModuleKey, PackageKey, PRESETS, VolumeUnit,
} from "@/lib/hq/quote-config";
import { computeQuote, matchBundle, QuoteInputs } from "@/lib/hq/quote-math";
import {
  Check, ChevronDown, Eye, EyeOff, Minus, Plus, RotateCcw, Sparkles,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   Animated number — counts toward its target whenever the target moves.
   Interruptible: a mid-animation change re-animates from the current value.
──────────────────────────────────────────────────────────────────────────── */
function useCountUp(target: number, duration = 500): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const value = from + (target - from) * eased;
      displayRef.current = value;
      setDisplay(value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-AU");

function Money({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={cn("tabular-nums", className)}>{fmt(v)}</span>;
}

/* ────────────────────────────────────────────────────────────────────────────
   Assumptions persistence (same localStorage key as the standalone tool)
──────────────────────────────────────────────────────────────────────────── */
type Json = Record<string, unknown>;
function deepMerge<T extends Json>(base: T, over: Json): T {
  for (const k in over) {
    const o = over[k];
    if (o && typeof o === "object" && !Array.isArray(o)) {
      base[k as keyof T] = deepMerge((base[k] ?? {}) as Json, o as Json) as T[keyof T];
    } else {
      base[k as keyof T] = o as T[keyof T];
    }
  }
  return base;
}
function freshDefaults(): Assumptions {
  return JSON.parse(JSON.stringify(DEFAULTS)) as Assumptions;
}

/* ────────────────────────────────────────────────────────────────────────────
   Page component
──────────────────────────────────────────────────────────────────────────── */
export function QuoteBuilder() {
  const [bizType, setBizType]   = useState<BizType>("physio");
  const [inputs, setInputs]     = useState<QuoteInputs>({ ...PRESETS.physio, ...{ locations: 1 } } as QuoteInputs);
  const [pkg, setPkg]           = useState<PackageKey>("fdp");
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set(BUNDLES.fdp.mods));
  const [annual, setAnnual]     = useState(false);
  const [internal, setInternal] = useState(false);
  const [A, setA]               = useState<Assumptions>(freshDefaults);
  const [storageOk, setStorageOk] = useState(true);

  // Load tuned assumptions after mount (localStorage isn't available in SSR)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setA(deepMerge(freshDefaults() as unknown as Json, JSON.parse(raw)) as unknown as Assumptions);
    } catch { setStorageOk(false); }
  }, []);

  function saveAssumptions(next: Assumptions) {
    setA(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); setStorageOk(true); }
    catch { setStorageOk(false); }
  }

  const q = useMemo(
    () => computeQuote({ inputs, A, selected, pkg, annual }),
    [inputs, A, selected, pkg, annual],
  );

  function set<K extends keyof QuoteInputs>(key: K, value: QuoteInputs[K]) {
    setInputs((s) => ({ ...s, [key]: value }));
  }
  function applyPreset(t: BizType) {
    setBizType(t);
    const p = PRESETS[t];
    setInputs((s) => ({ ...s, ...p }));
  }
  function pickPkg(p: PackageKey) {
    setPkg(p);
    if (p === "custom") {
      if (selected.size === 0) setSelected(new Set<ModuleKey>(["inbound"]));
    } else {
      setSelected(new Set(BUNDLES[p].mods));
    }
  }
  function toggleMod(k: ModuleKey) {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelected(next);
    setPkg(matchBundle(next));
  }

  return (
    <div className="space-y-5">
      {/* Top bar: view switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Discovery answers build the price live. Figures ex-GST — estimates to start a conversation, not a contract.
        </p>
        <button
          type="button"
          onClick={() => setInternal((v) => !v)}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
            internal
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-background hover:bg-muted/40",
          )}
        >
          {internal ? <EyeOff size={13} /> : <Eye size={13} />}
          {internal ? "Internal view — don't screen-share" : "Client view"}
        </button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        {/* ── Left: discovery + build ─────────────────────────────────────── */}
        <div className="space-y-5">
          <Card step={1} title="Discovery" sub="Their answers build the price, live">
            <div className="space-y-4">
              <Field label="Business type">
                <select
                  className={inputCls}
                  value={bizType}
                  onChange={(e) => applyPreset(e.target.value as BizType)}
                >
                  {Object.entries(BIZ_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Practitioner calendars" hint="to integrate">
                  <Stepper value={inputs.calendars} onChange={(v) => set("calendars", v)} />
                </Field>
                <Field label="Locations">
                  <Stepper value={inputs.locations} onChange={(v) => set("locations", v)} />
                </Field>
              </div>

              <Field label="Call volume" hint="enter it however they say it">
                <div className="flex gap-2">
                  <NumInput value={inputs.calls} onChange={(v) => set("calls", v)} className="flex-1" />
                  <div className="flex rounded-lg border bg-muted/30 p-0.5">
                    {(["day", "week", "month"] as VolumeUnit[]).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => set("vu", u)}
                        className={cn(
                          "rounded-md px-2.5 text-xs font-medium capitalize transition-all",
                          inputs.vu === u ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        /{u}
                      </button>
                    ))}
                  </div>
                </div>
                {inputs.calls > 0 && (
                  <p className="mt-1.5 text-[11px] font-medium text-primary">
                    ≈ {fmt(q.monthlyCalls)} calls / month · ~{fmt(q.estMin)} talk-min / month
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Avg call length" hint="min">
                  <NumInput value={inputs.dur} step={0.5} onChange={(v) => set("dur", v)} />
                </Field>
                <Field label="New enquiries" hint="/ mo">
                  <NumInput value={inputs.leads} onChange={(v) => set("leads", v)} />
                </Field>
                <Field label="Active client base">
                  <NumInput value={inputs.clients} onChange={(v) => set("clients", v)} />
                </Field>
                <Field label="Reactivation list" hint="lapsed contacts">
                  <NumInput value={inputs.contacts} onChange={(v) => set("contacts", v)} />
                </Field>
                <Field label="Avg job / appt value" hint="$">
                  <NumInput value={inputs.jobValue} onChange={(v) => set("jobValue", v)} />
                </Field>
                <Field label="Calls unanswered" hint="% est.">
                  <NumInput value={inputs.missRate} onChange={(v) => set("missRate", v)} />
                </Field>
              </div>
            </div>
          </Card>

          <Card step={2} title="Build the solution" sub="Pick a package, or compose à la carte">
            {/* Package tabs */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["custom", "À la carte", "build it up", false],
                ["fd",  "Front Desk",     `save ${A.discFd}%`,  false],
                ["fdp", "Front Desk Pro", `save ${A.discFdp}%`, true],
                ["ge",  "Growth Engine",  `save ${A.discGe}%`,  false],
              ] as [PackageKey, string, string, boolean][]).map(([key, name, save, popular]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickPkg(key)}
                  className={cn(
                    "relative rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.98]",
                    pkg === key
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "bg-background hover:border-primary/40",
                  )}
                >
                  {popular && (
                    <span className="absolute -top-2 right-2 rounded-md bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                      POPULAR
                    </span>
                  )}
                  <div className="text-[13px] font-semibold leading-tight">{name}</div>
                  <div className={cn("mt-1 text-[11px] font-semibold", key === "custom" ? "text-muted-foreground" : "text-emerald-600")}>
                    {save}
                  </div>
                </button>
              ))}
            </div>

            {/* Modules */}
            <div className="space-y-1.5">
              {MOD_ORDER.map((k) => {
                const on = selected.has(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleMod(k)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.99]",
                      on ? "border-primary bg-primary/5" : "bg-background hover:border-primary/40",
                    )}
                  >
                    <span className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-all duration-150",
                      on ? "scale-100 border-primary bg-primary" : "border-muted-foreground/30",
                    )}>
                      <Check size={12} className={cn("text-primary-foreground transition-all duration-150", on ? "scale-100 opacity-100" : "scale-50 opacity-0")} />
                    </span>
                    <span className="flex-1 text-[13px] font-medium">{A[k].name}</span>
                    {A[k].voice && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-600">
                        VOICE
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ── Right: the quote (sticky) ───────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-4">
          {/* Pain panel */}
          <div className="relative overflow-hidden rounded-xl bg-[linear-gradient(155deg,#16121f,#2a2435)] p-5 text-white shadow-lg">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(108,75,241,.4),transparent_70%)]" />
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#b9aef5]">
              Estimated revenue leaking out the door
            </div>
            <div className="mt-1 text-4xl font-extrabold tracking-tight">
              $<Money value={q.leakYear} /><span className="text-sm font-semibold text-[#9a8fe0]"> / year</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#cfc8e8]">
              ≈ {fmt(q.missCalls)} calls a month go unanswered. At {A.leadConv}% conversion and
              ${fmt(inputs.jobValue)} average value, that&apos;s revenue walking out.
            </p>
            <div className="mt-4 flex flex-wrap gap-5">
              <PainStat v={fmt(q.missCalls)} k="missed calls / mo" />
              <PainStat v={`$${fmt(q.leakMonth)}`} k="lost / month" />
              <PainStat v={`$${fmt(A.humanMonthly)}`} k="a human reception desk" />
            </div>
          </div>

          {/* Quote card */}
          <div className="overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/5">
            <div className="px-5 pt-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                <Sparkles size={10} /> Tailored for: {q.profileName}
              </span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{q.pkgName}</h2>
                {q.discount > 0 && (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600 animate-in fade-in zoom-in-95 duration-200">
                    save {Math.round(q.discount * 100)}%
                  </span>
                )}
              </div>
            </div>

            {/* Breakdown */}
            <div className="px-5 pt-1">
              <div className="flex justify-between pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span>Your bespoke build</span><span>setup · monthly</span>
              </div>
              {q.items.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Select at least one product →</p>
              ) : (
                q.items.map((it) => (
                  <div
                    key={it.label}
                    className="flex items-baseline justify-between gap-3 border-b border-dashed py-2 text-[13px] animate-in fade-in slide-in-from-bottom-1 duration-300"
                  >
                    <span className={cn(it.anchor ? "font-semibold" : "font-medium", it.campaign ? "text-amber-600" : "text-foreground/80")}>
                      {it.label}
                      {it.sub && <span className="block text-[11px] font-normal text-muted-foreground">{it.sub}</span>}
                    </span>
                    <span className={cn("whitespace-nowrap text-right font-semibold tabular-nums", it.campaign && "text-amber-600")}>
                      {it.campaign
                        ? <>${fmt(it.campaignCost ?? 0)} <span className="text-muted-foreground">/run</span></>
                        : <>${fmt(it.setup)} · <span className="text-primary">${fmt(it.monthly)}</span></>}
                    </span>
                  </div>
                ))
              )}
              {q.items.length > 0 && (
                <div className="flex justify-between py-2.5 text-[13px] font-semibold text-muted-foreground">
                  <span>Standalone value</span>
                  <span className="tabular-nums">${fmt(q.setupRaw)} · ${fmt(q.monthlyRaw)}/mo</span>
                </div>
              )}
              {q.aboveTopBand && (
                <div className="mb-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 animate-in fade-in duration-300">
                  <b>High call volume.</b> Above the top band — confirm concurrency &amp; capacity before quoting; the figure shown is a floor.
                </div>
              )}
            </div>

            {/* Price rows */}
            <div className="px-5">
              <div className="flex items-baseline justify-between border-t py-3">
                <div className="text-[13px] font-semibold text-foreground/80">
                  One-off setup
                  <span className="block text-[11px] font-normal text-muted-foreground">build, integrate &amp; tune</span>
                </div>
                <div className="text-right">
                  {q.discount > 0 && !internal && (
                    <span className="block text-xs text-muted-foreground line-through">${fmt(q.setupRaw)}</span>
                  )}
                  <span className="text-xl font-bold tracking-tight">$<Money value={q.setupFinal} /></span>
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t py-3">
                <div className="text-sm font-semibold">
                  Monthly retainer
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {q.discount > 0 ? `${q.pkgName} · ${Math.round(q.discount * 100)}% bundle saving applied` : "managed & optimised"}
                  </span>
                </div>
                <div className="text-right">
                  {q.discount > 0 && !internal && (
                    <span className="block text-xs text-muted-foreground line-through">${fmt(q.monthlyRaw)}</span>
                  )}
                  <span className="text-2xl font-bold tracking-tight text-primary">
                    $<Money value={q.monthlyFinal} /><span className="text-sm font-medium text-muted-foreground">/mo</span>
                  </span>
                </div>
              </div>
              {selected.has("outbound") && (
                <div className="flex items-baseline justify-between border-t py-3 animate-in fade-in duration-300">
                  <div className="text-[13px] font-semibold text-foreground/80">
                    Reactivation campaign
                    <span className="block text-[11px] font-normal text-muted-foreground">billed per run, not monthly</span>
                  </div>
                  <span className="text-xl font-bold tracking-tight">
                    $<Money value={q.campaignCost} /><span className="text-sm font-medium text-muted-foreground">/run</span>
                  </span>
                </div>
              )}
            </div>

            {/* Outbound ROI */}
            {q.outboundRoi && (
              <div className="px-5 pb-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                <div className="rounded-xl bg-[linear-gradient(150deg,#0f5e40,#127a53)] p-4 text-white">
                  <p className="text-xs leading-relaxed text-[#d6f0e4]">
                    <b className="text-white">{fmt(inputs.contacts)} contacts</b> at ~{A.obConvExp}% rebooking
                    ≈ <b className="text-white">{fmt(q.outboundRoi.bookExp)} patients</b> back in the diary.
                  </p>
                  <div className="my-1 text-2xl font-extrabold tracking-tight">
                    $<Money value={q.outboundRoi.recExp} /> <span className="text-[13px] font-semibold text-[#a6dcc4]">recovered</span>
                  </div>
                  <p className="text-xs text-[#bfe6d4]">
                    {A.obVisits} visits × ${fmt(inputs.jobValue)} each. The ${fmt(q.campaignCost)} run fee is{" "}
                    <b className="text-white">{q.outboundRoi.takePct.toFixed(1)}%</b> of what it brings back.
                  </p>
                  <div className="mt-2.5 flex justify-between border-t border-white/20 pt-2.5 text-[11px] text-[#a6dcc4]">
                    <span>Floor {A.obConvLow}%: <b className="text-white">${fmt(q.outboundRoi.recLow)}</b></span>
                    <span>Strong {A.obConvHigh}%: <b className="text-white">${fmt(q.outboundRoi.recHigh)}</b></span>
                  </div>
                </div>
              </div>
            )}

            {/* Annual prepay */}
            <button
              type="button"
              onClick={() => setAnnual((v) => !v)}
              className="flex w-full items-center gap-3 bg-primary/5 px-5 py-3.5 text-left transition-colors hover:bg-primary/10"
            >
              <span className={cn(
                "relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200",
                annual ? "bg-primary" : "bg-muted-foreground/25",
              )}>
                <span className={cn(
                  "absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200",
                  annual && "translate-x-[17px]",
                )} />
              </span>
              <span className="text-[13px] font-medium">
                Annual prepay — <b className="text-primary">pay 10, get 12</b>
                {annual && (
                  <span className="ml-1.5 text-muted-foreground animate-in fade-in duration-200">
                    · save ${fmt(q.annualSaving)}/yr
                  </span>
                )}
              </span>
            </button>

            {/* Client ROI */}
            {!internal && (
              <div className="space-y-2 border-t px-5 py-4">
                <RoiLine k="Recovers (annual leakage)" v={<>$<Money value={q.leakYear} /></>} good />
                <RoiLine k="Total year-one investment" v={<>$<Money value={q.yearOne} /></>} />
                <RoiLine k="vs a full-time receptionist" v={<>${fmt(A.humanMonthly * 12)}/yr</>} />
                <div className="mt-2 rounded-lg bg-emerald-500/10 px-3.5 py-3 text-[13px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                  {q.items.length === 0
                    ? "Add products to see the ROI story."
                    : q.leakYear - q.yearOne > 0
                      ? <>Recovers <b className="text-emerald-600 dark:text-emerald-400">${fmt(q.leakYear - q.yearOne)}</b> more than it costs in year one, and runs at a fraction of a ${fmt(A.humanMonthly * 12)}/yr reception desk, 24/7.</>
                      : <>Runs at a fraction of a ${fmt(A.humanMonthly * 12)}/yr reception desk, 24/7, and captures the after-hours calls a desk never will.</>}
                </div>
              </div>
            )}

            {/* Internal margins */}
            {internal && (
              <div className="border-t-2 border-dashed border-primary bg-primary/5 px-5 py-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Internal — do not screen-share
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <IbCell k="Est. monthly COGS" v={<>$<Money value={q.cogs} /></>} />
                  <IbCell
                    k="Gross margin"
                    v={<>{Math.round(q.marginPct)}%</>}
                    tone={q.marginPct >= 65 ? "good" : q.marginPct >= 45 ? "mid" : "bad"}
                  />
                  <IbCell k="Est. voice minutes" v={fmt(q.voiceMin)} />
                  <IbCell k="Gross profit / mo" v={<>$<Money value={q.grossProfit} /></>} />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Standalone baseline ${fmt(q.setupRaw)} / ${fmt(q.monthlyRaw)}mo · discount {Math.round(q.discount * 100)}%
                  · profile: {q.profileName} · {fmt(q.monthlyCalls)} calls/mo.
                  {selected.has("outbound") && (
                    <> · Campaign: ${fmt(q.campaignCost)} rev / ~${fmt(q.campaignCogs)} cost = ${fmt(q.campaignCost - q.campaignCogs)} gross per run.</>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Assumptions ─────────────────────────────────────────────────────── */}
      <AssumptionsPanel A={A} onChange={saveAssumptions} storageOk={storageOk} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Small building blocks
──────────────────────────────────────────────────────────────────────────── */
const inputCls = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

function Card({ step, title, sub, children }: {
  step: number; title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="flex items-center gap-2.5 border-b px-5 py-3.5">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-[13px] font-bold text-primary">{step}</span>
        <div>
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground/80">
        {label} {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, step, className }: {
  value: number; onChange: (v: number) => void; step?: number; className?: string;
}) {
  return (
    <input
      type="number"
      step={step ?? "any"}
      min={0}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={cn(inputCls, className)}
    />
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border bg-background">
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))}
        className="grid w-9 place-items-center text-primary transition-colors hover:bg-primary/10 active:bg-primary/20">
        <Minus size={14} />
      </button>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-full border-x bg-transparent py-2 text-center text-sm font-bold outline-none"
      />
      <button type="button" onClick={() => onChange(value + 1)}
        className="grid w-9 place-items-center text-primary transition-colors hover:bg-primary/10 active:bg-primary/20">
        <Plus size={14} />
      </button>
    </div>
  );
}

function PainStat({ v, k }: { v: string; k: string }) {
  return (
    <div className="min-w-[90px]">
      <div className="text-lg font-bold tracking-tight tabular-nums">{v}</div>
      <div className="text-[11px] text-[#a99ee0]">{k}</div>
    </div>
  );
}

function RoiLine({ k, v, good }: { k: string; v: React.ReactNode; good?: boolean }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-bold tabular-nums", good && "text-emerald-600")}>{v}</span>
    </div>
  );
}

function IbCell({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "good" | "mid" | "bad" }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className={cn(
        "mt-0.5 text-lg font-bold tracking-tight tabular-nums",
        tone === "good" && "text-emerald-600",
        tone === "mid"  && "text-amber-600",
        tone === "bad"  && "text-destructive",
      )}>{v}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Assumptions editor — every tunable from the original, grouped the same way
──────────────────────────────────────────────────────────────────────────── */
function AssumptionsPanel({ A, onChange, storageOk }: {
  A: Assumptions; onChange: (a: Assumptions) => void; storageOk: boolean;
}) {
  const [open, setOpen] = useState(false);

  function patch(fn: (draft: Assumptions) => void) {
    const next = JSON.parse(JSON.stringify(A)) as Assumptions;
    fn(next);
    onChange(next);
  }
  const n = (v: string) => { const x = parseFloat(v); return Number.isNaN(x) ? 0 : x; };

  return (
    <div className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-sm font-semibold"
      >
        Pricing assumptions — tap to tune
        <span className="text-xs font-normal text-muted-foreground">(changes save automatically in this browser)</span>
        <ChevronDown size={15} className={cn("ml-auto text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t px-5 py-5 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
            <AssHead>Inbound anchor — assembled from discovery</AssHead>
            <AssPair l1="Base setup" v1={A.inbound.setupBase} f1={(v) => patch((d) => { d.inbound.setupBase = n(v); })}
                     l2="Base monthly" v2={A.inbound.monthlyBase} f2={(v) => patch((d) => { d.inbound.monthlyBase = n(v); })} />
            <AssPair l1="Setup / extra calendar" v1={A.inbound.perCalendarSetup} f1={(v) => patch((d) => { d.inbound.perCalendarSetup = n(v); })}
                     l2="Monthly / extra calendar" v2={A.inbound.perCalendarMonthly} f2={(v) => patch((d) => { d.inbound.perCalendarMonthly = n(v); })} />
            <AssPair l1="Setup / extra location" v1={A.inbound.perLocationSetup} f1={(v) => patch((d) => { d.inbound.perLocationSetup = n(v); })}
                     l2="Monthly / extra location" v2={A.inbound.perLocationMonthly} f2={(v) => patch((d) => { d.inbound.perLocationMonthly = n(v); })} />

            <AssHead>Call-volume bands — monthly add by est. minutes</AssHead>
            {A.bands.map((b, i) => (
              <AssPair key={b.label} l1={`${b.label} — up to (min)`} v1={b.max} f1={(v) => patch((d) => { d.bands[i].max = n(v); })}
                       l2="+$ / mo" v2={b.add} f2={(v) => patch((d) => { d.bands[i].add = n(v); })} />
            ))}

            <AssHead>Outbound agent — per-campaign</AssHead>
            <AssNum label="Build setup ($)" value={A.outbound.setup} onChange={(v) => patch((d) => { d.outbound.setup = n(v); })} />
            <AssNum label="Price per contact ($)" value={A.outbound.perContact} onChange={(v) => patch((d) => { d.outbound.perContact = n(v); })} />
            <AssNum label="Rebook % floor" value={A.obConvLow} onChange={(v) => patch((d) => { d.obConvLow = n(v); })} />
            <AssNum label="Rebook % expected" value={A.obConvExp} onChange={(v) => patch((d) => { d.obConvExp = n(v); })} />
            <AssNum label="Rebook % strong" value={A.obConvHigh} onChange={(v) => patch((d) => { d.obConvHigh = n(v); })} />
            <AssNum label="Visits per reactivated patient" value={A.obVisits} onChange={(v) => patch((d) => { d.obVisits = n(v); })} />

            <AssHead>Other modules — setup / monthly ($)</AssHead>
            {FLAT_MODS.map((k) => (
              <AssPair key={k} l1={`${A[k].name} — setup`} v1={A[k].setup} f1={(v) => patch((d) => { d[k].setup = n(v); })}
                       l2="monthly" v2={A[k].monthly} f2={(v) => patch((d) => { d[k].monthly = n(v); })} />
            ))}

            <AssHead>Bundle discounts (%)</AssHead>
            <AssNum label="Front Desk" value={A.discFd} onChange={(v) => patch((d) => { d.discFd = n(v); })} />
            <AssNum label="Front Desk Pro" value={A.discFdp} onChange={(v) => patch((d) => { d.discFdp = n(v); })} />
            <AssNum label="Growth Engine" value={A.discGe} onChange={(v) => patch((d) => { d.discGe = n(v); })} />

            <AssHead>Internal cost &amp; pitch maths</AssHead>
            <AssNum label="Voice cost $/min" value={A.cogsPerMin} onChange={(v) => patch((d) => { d.cogsPerMin = n(v); })} />
            <AssNum label="SMS cost $" value={A.smsCost} onChange={(v) => patch((d) => { d.smsCost = n(v); })} />
            <AssNum label="Platform $/mo" value={A.platformCost} onChange={(v) => patch((d) => { d.platformCost = n(v); })} />
            <AssNum label="Lead conversion %" value={A.leadConv} onChange={(v) => patch((d) => { d.leadConv = n(v); })} />
            <AssNum label="Human desk $/mo" value={A.humanMonthly} onChange={(v) => patch((d) => { d.humanMonthly = n(v); })} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
                onChange(freshDefaults());
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <RotateCcw size={12} /> Reset to defaults
            </button>
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", storageOk ? "text-emerald-600" : "text-amber-600")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", storageOk ? "bg-emerald-600" : "bg-amber-600")} />
              {storageOk ? "Saved to this browser" : "Browser blocked saving — using built-in defaults"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function AssHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="col-span-full mt-1 text-[11px] font-bold uppercase tracking-wider text-primary">
      {children}
    </h3>
  );
}

function AssNum({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-foreground/80">{label}</span>
      <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "px-2.5 py-1.5")} />
    </label>
  );
}

function AssPair({ l1, v1, f1, l2, v2, f2 }: {
  l1: string; v1: number; f1: (v: string) => void;
  l2: string; v2: number; f2: (v: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-semibold text-foreground/80">{l1} / {l2}</span>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" step="any" value={v1} onChange={(e) => f1(e.target.value)} className={cn(inputCls, "px-2.5 py-1.5")} />
        <input type="number" step="any" value={v2} onChange={(e) => f2(e.target.value)} className={cn(inputCls, "px-2.5 py-1.5")} />
      </div>
    </div>
  );
}
