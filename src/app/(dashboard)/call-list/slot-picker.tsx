"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PERSON_LABEL, type DaySlots, type Person, type Slot } from "@/lib/hq/availability";
import { clinicClockForSlot } from "@/lib/hq/clinic-time";
import { formatSydney } from "@/lib/hq/sydney-time";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";

export type Picked = { start: string; person: Person };

type SlotsResponse = {
  configured: boolean;
  setupNeeded: boolean;
  days: DaySlots[];
  source: "calendar" | "crm-only";
  horizonDays: number;
};

type Who = "anyone" | Person;

const PERSON_STYLE: Record<Person, string> = {
  ryan: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  lachlan: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

/**
 * The booking buttons: every time a sales call can go in, for Ryan and/or
 * Lachlan. A time only appears if it's inside that person's hours, they
 * haven't blocked it out, and nothing on the shared calendar overlaps it, so
 * the caller can only ever pick a time that works.
 */
export function SlotPicker({
  lead, value, onPick, refreshKey, onUnavailable, onManual,
}: {
  lead: { address: string | null; phone: string | null };
  value: Picked | null;
  onPick: (v: Picked | null) => void;
  /** Change this to re-load the times (e.g. after a booking attempt failed because a slot was just taken). */
  refreshKey: number;
  /** Called when there are no hours set up yet, or the times couldn't be loaded. */
  onUnavailable: (why: "not-set-up" | "error") => void;
  /** Present only for people allowed to type any time. */
  onManual?: () => void;
}) {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [who, setWho] = useState<Who>("anyone");
  const [date, setDate] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(14);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/availability/slots?days=${horizon}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("bad response");
        return (await res.json()) as SlotsResponse;
      })
      .then((d) => {
        if (cancelled) return;
        if (!d.configured) { onUnavailable("not-set-up"); return; }
        setData(d);
        setState("ready");
      })
      .catch(() => { if (!cancelled) onUnavailable("error"); });
    return () => { cancelled = true; };
    // onUnavailable is stable enough for this: it only flips a flag in the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, horizon]);

  // The list for the chosen person: each time shows who would take it.
  const days = useMemo(() => {
    return (data?.days ?? [])
      .map((d) => ({
        ...d,
        slots: d.slots.flatMap((s: Slot) =>
          who === "anyone" ? [{ ...s, person: s.suggested }] : s.free.includes(who) ? [{ ...s, person: who }] : [],
        ),
      }))
      .filter((d) => d.slots.length > 0);
  }, [data, who]);

  const active = days.find((d) => d.date === date) ?? days[0] ?? null;

  // If the chosen time vanished (someone took it, or the filter changed), drop the choice.
  useEffect(() => {
    if (!value) return;
    const still = days.some((d) => d.slots.some((s) => s.start === value.start && s.person === value.person));
    if (!still) onPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Finding times when Ryan or Lachlan are free…
      </p>
    );
  }

  const picked = value ? clinicClockForSlot(lead, value.start) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground/80">Who with</span>
        <div role="radiogroup" aria-label="Who the call is with" className="inline-flex gap-0.5 rounded-full border bg-background p-[3px]">
          {([["anyone", "Anyone"], ["ryan", "Ryan"], ["lachlan", "Lachlan"]] as [Who, string][]).map(([v, label]) => (
            <label key={v} className="relative block">
              <input type="radio" name="slot-who" value={v} checked={who === v} onChange={() => setWho(v)} className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" />
              <span className="block rounded-full px-3.5 py-1 text-[13px] font-semibold text-muted-foreground transition-colors peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {data?.source === "crm-only" && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Couldn&apos;t read Google Calendar just now, so these times only account for bookings made in the CRM. Double-check with Ryan or Lachlan if it matters.
        </p>
      )}

      {days.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-background px-4 py-5 text-center text-sm text-muted-foreground">
          No free times in the next {data?.horizonDays ?? horizon} days{who !== "anyone" ? ` for ${PERSON_LABEL[who]}` : ""}.
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {who !== "anyone" && <button type="button" onClick={() => setWho("anyone")} className="text-xs font-semibold text-primary hover:underline">Try anyone</button>}
            {horizon < 35 && <button type="button" onClick={() => setHorizon(35)} className="text-xs font-semibold text-primary hover:underline">Look further ahead</button>}
          </div>
          <p className="mt-2 text-xs">Otherwise save a note or set a callback, and let Ryan or Lachlan know.</p>
        </div>
      ) : (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-foreground/80">Day</div>
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setDate(d.date)}
                  aria-pressed={active?.date === d.date}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                    active?.date === d.date ? "border-primary bg-primary/10 text-primary" : "bg-background hover:border-primary/50",
                  )}
                >
                  <span className="block font-semibold">{d.relative ?? d.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{d.relative ? d.label : `${d.slots.length} free`}{d.relative ? ` · ${d.slots.length} free` : ""}</span>
                </button>
              ))}
            </div>
            {horizon < 35 && (
              <button type="button" onClick={() => setHorizon(35)} className="mt-1.5 text-xs font-semibold text-primary hover:underline">Look further ahead</button>
            )}
          </div>

          {active && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-foreground/80">
                Time <span className="font-normal text-muted-foreground">(Sydney time, 30 minutes)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {active.slots.map((s) => {
                  const on = value?.start === s.start && value.person === s.person;
                  return (
                    <button
                      key={`${s.start}-${s.person}`}
                      type="button"
                      onClick={() => onPick({ start: s.start, person: s.person })}
                      aria-pressed={on}
                      title={`${s.time} with ${PERSON_LABEL[s.person]}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold tabular-nums transition-all active:scale-[0.96]",
                        on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/60",
                      )}
                    >
                      {s.time}
                      {who === "anyone" && (
                        <span className={cn("grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold", on ? "bg-white/25 text-white" : PERSON_STYLE[s.person])}>
                          {PERSON_LABEL[s.person][0]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {who === "anyone" && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("mr-1 inline-grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] font-bold", PERSON_STYLE.ryan)}>R</span>Ryan
                  <span className={cn("ml-3 mr-1 inline-grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] font-bold", PERSON_STYLE.lachlan)}>L</span>Lachlan
                  <span className="ml-3">The letter shows who takes that call.</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {value && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
          <CalendarClock size={14} />
          {formatSydney(value.start)} Sydney time, with {PERSON_LABEL[value.person]}
          {picked && <span className="font-normal text-foreground/80">· that&apos;s {picked.clock} for this {picked.state} clinic</span>}
        </p>
      )}

      {onManual && (
        <button type="button" onClick={onManual} className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline">
          Pick a different time
        </button>
      )}
    </div>
  );
}
