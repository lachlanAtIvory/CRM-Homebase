"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PEOPLE, PERSON_LABEL, type Person } from "@/lib/hq/availability";
import type { DayHours, EditorBlock, EditorData } from "@/lib/hq/availability-admin";
import { addDaysToDate, formatDateLabel, formatSydneyClock, startOfSydneyDate, sydneyDateOf } from "@/lib/hq/sydney-time";
import { AlertTriangle, CalendarOff, Check, Loader2, Plus, Trash2 } from "lucide-react";

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";

/** Monday first, the way people think about a week. weekday numbers: 0 = Sunday. */
const WEEK: { weekday: number; label: string }[] = [
  { weekday: 1, label: "Monday" }, { weekday: 2, label: "Tuesday" }, { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" }, { weekday: 5, label: "Friday" }, { weekday: 6, label: "Saturday" }, { weekday: 0, label: "Sunday" },
];

/** Half-hour steps from 5:00 am to 10:00 pm. */
const TIMES: { value: string; label: string }[] = [];
for (let m = 5 * 60; m <= 22 * 60; m += 30) {
  const value = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const h12 = ((Math.floor(m / 60) + 11) % 12) + 1;
  TIMES.push({ value, label: `${h12}:${String(m % 60).padStart(2, "0")} ${m < 12 * 60 ? "am" : "pm"}` });
}

async function call<T>(url: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "That didn't work. Try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

const same = (a: DayHours[], b: DayHours[]) =>
  a.every((d, i) => d.enabled === b[i].enabled && (!d.enabled || (d.start === b[i].start && d.end === b[i].end)));

export function AvailabilityEditor({ initial }: { initial: EditorData }) {
  const [data, setData] = useState<EditorData>(initial);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function say(text: string, tone: "ok" | "error" = "ok") {
    setToast({ text, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone === "error" ? 7000 : 3000);
  }

  if (data.setupNeeded) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
        <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> One setup step first</div>
        In the Supabase SQL editor, paste in and run{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">supabase/migrations/20261019120000_add_call_availability.sql</code>, then reload this page. It
        starts you off with the hours you gave me.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {PEOPLE.map((p) => (
        <PersonHours key={p} person={p} saved={data.hours[p]} onSaved={(d) => { setData(d); say(`${PERSON_LABEL[p]}'s hours saved.`); }} onError={(e) => say(e, "error")} />
      ))}
      <TimeOff blocks={data.blocks} onData={setData} say={say} />

      {toast && (
        <div role="status" className={cn("fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-bottom-2", toast.tone === "error" ? "bg-destructive text-white" : "bg-foreground text-background")}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ── One person's weekly hours ───────────────────────────────────────────── */
function PersonHours({ person, saved, onSaved, onError }: {
  person: Person; saved: DayHours[]; onSaved: (d: EditorData) => void; onError: (e: string) => void;
}) {
  const [draft, setDraft] = useState<DayHours[]>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(saved); }, [saved]);
  const dirty = !same(draft, saved);

  const set = (weekday: number, patch: Partial<DayHours>) => setDraft((d) => d.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)));
  const openDays = draft.filter((d) => d.enabled).length;

  async function save() {
    setBusy(true);
    const r = await call<EditorData & { ok: true }>("/api/availability", "PUT", { person, days: draft });
    setBusy(false);
    if (!r.ok) { onError(r.error); return; }
    onSaved(r.data);
  }

  function copyMondayToWeekdays() {
    const mon = draft.find((d) => d.weekday === 1)!;
    setDraft((d) => d.map((x) => ([2, 3, 4, 5].includes(x.weekday) ? { ...x, enabled: mon.enabled, start: mon.start, end: mon.end } : x)));
  }

  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">{PERSON_LABEL[person]}&apos;s hours</h2>
          <p className="text-xs text-muted-foreground">
            {openDays === 0 ? "Not taking any calls." : `Takes calls on ${openDays} day${openDays === 1 ? "" : "s"} a week.`} Each call is 30 minutes.
          </p>
        </div>
        <button type="button" onClick={copyMondayToWeekdays} className="text-xs font-semibold text-primary hover:underline">Copy Monday to Tue to Fri</button>
      </div>

      <ul className="divide-y">
        {WEEK.map(({ weekday, label }) => {
          const d = draft.find((x) => x.weekday === weekday)!;
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <Toggle on={d.enabled} label={`${PERSON_LABEL[person]} takes calls on ${label}`} onClick={() => set(weekday, { enabled: !d.enabled })} />
              <span className={cn("w-24 text-sm font-semibold", !d.enabled && "text-muted-foreground")}>{label}</span>
              {d.enabled ? (
                <span className="flex items-center gap-2 text-sm">
                  <TimeSelect value={d.start} label={`${label} start`} onChange={(v) => set(weekday, { start: v })} />
                  <span className="text-muted-foreground">to</span>
                  <TimeSelect value={d.end} label={`${label} end`} onChange={(v) => set(weekday, { end: v })} />
                  {d.end <= d.start && <span className="text-xs font-semibold text-destructive">End must be after the start</span>}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not available</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 border-t px-5 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy || draft.some((d) => d.enabled && d.end <= d.start)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Save {PERSON_LABEL[person]}&apos;s hours
        </button>
        {dirty && (
          <>
            <button type="button" onClick={() => setDraft(saved)} disabled={busy} className="rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40">Discard changes</button>
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Unsaved changes</span>
          </>
        )}
      </div>
    </section>
  );
}

function TimeSelect({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const known = TIMES.some((t) => t.value === value);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring">
      {!known && <option value={value}>{value}</option>}
      {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-primary" : "bg-muted-foreground/30")}>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/* ── Time off ────────────────────────────────────────────────────────────── */
function describeBlock(b: EditorBlock): string {
  const startDate = sydneyDateOf(b.starts_at);
  const midnight = (iso: string) => new Date(iso).getTime() === new Date(startOfSydneyDate(sydneyDateOf(iso))).getTime();
  if (midnight(b.starts_at) && midnight(b.ends_at)) {
    const last = addDaysToDate(sydneyDateOf(b.ends_at), -1);
    return last === startDate ? `${formatDateLabel(startDate)}, all day` : `${formatDateLabel(startDate)} to ${formatDateLabel(last)}, all day`;
  }
  return `${formatDateLabel(startDate)}, ${formatSydneyClock(b.starts_at)} to ${formatSydneyClock(b.ends_at)}`;
}

function TimeOff({ blocks, onData, say }: {
  blocks: EditorBlock[]; onData: (d: EditorData) => void; say: (t: string, tone?: "ok" | "error") => void;
}) {
  const [person, setPerson] = useState<Person>("ryan");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [fromTime, setFromTime] = useState("09:00");
  const [toTime, setToTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await call<EditorData & { ok: true }>("/api/availability/blocks", "POST", { person, from, to: to || from, allDay, fromTime, toTime, reason });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onData(r.data);
    setFrom(""); setTo(""); setReason("");
    say("Time off added. Those times won't be offered.");
  }

  async function remove(b: EditorBlock) {
    const r = await call<EditorData & { ok: true }>(`/api/availability/blocks/${b.id}`, "DELETE");
    if (!r.ok) { say(r.error, "error"); return; }
    onData(r.data);
    say("Time off removed.");
  }

  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarOff size={14} /> Time off</h2>
        <p className="text-xs text-muted-foreground">
          Holidays, a dentist appointment, anything. Those times stop being offered. (Anything you add to the shared Google Calendar blocks times too.)
        </p>
      </div>

      {blocks.length > 0 && (
        <ul className="divide-y">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-16 shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-center text-[11px] font-bold text-primary">{PERSON_LABEL[b.person]}</span>
              <span className="min-w-0 flex-1 truncate">{describeBlock(b)}{b.reason && <span className="text-muted-foreground"> · {b.reason}</span>}</span>
              <button type="button" onClick={() => remove(b)} aria-label="Remove this time off" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className={cn("space-y-3 p-5", blocks.length > 0 && "border-t")}>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Who</span>
            <select value={person} onChange={(e) => setPerson(e.target.value as Person)} className={inputCls}>
              {PEOPLE.map((p) => <option key={p} value={p}>{PERSON_LABEL[p]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">{allDay ? "From" : "On"}</span>
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          {allDay && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Until <span className="font-normal text-muted-foreground">(optional)</span></span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-primary" /> All day
        </label>
        {!allDay && (
          <div className="flex items-center gap-2 text-sm">
            <TimeSelect value={fromTime} label="From time" onChange={setFromTime} /> <span className="text-muted-foreground">to</span> <TimeSelect value={toTime} label="To time" onChange={setToTime} />
          </div>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Reason <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Holiday" maxLength={120} className={inputCls} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">{error}</p>}
        <button type="submit" disabled={busy || !from} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add time off
        </button>
      </form>
    </section>
  );
}
