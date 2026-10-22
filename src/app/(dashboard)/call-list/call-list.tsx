"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  OUTCOME_LABEL, STATUS_LABEL, TAB_LABEL,
  type CallLead, type CallLeadNote, type LeadStatus, type Outcome, type SalesCallWith, type Tab, type TabCounts,
} from "@/lib/hq/call-leads";
import { parsePhone } from "@/lib/hq/phone";
import { WEBSITE_FROM_KEY } from "@/lib/hq/website-guess";
import { clinicClockForSlot, clinicTime } from "@/lib/hq/clinic-time";
import { PERSON_LABEL } from "@/lib/hq/availability";
import { describeCall, formatDuration } from "@/lib/hq/call-format";
import type { CallActivity } from "@/lib/hq/dialsheet-events";
import { SlotPicker, type Picked } from "./slot-picker";
import {
  formatSydney, formatViewerLocal, quickTimes, sydneyWallToISO, viewerIsOnSydneyTime,
} from "@/lib/hq/sydney-time";
import type { MotivationStats } from "@/lib/hq/motivation-stats";
import { actorDisplayName, type Actor } from "@/lib/hq/motivation-stats";
import {
  Bell, Ban, CalendarCheck, CalendarClock, Check, Clock, Copy, ExternalLink, Globe, Loader2, Mail,
  MapPin, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, Star, ThumbsDown, Trash2, Upload, Voicemail, X, XCircle,
} from "lucide-react";

export type CallListInitial = {
  leads: CallLead[];
  total: number;
  counts: TabCounts;
  stats: MotivationStats;
};

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

/** http(s) links only — scraped data must never become a javascript: link. */
function safeUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the older route */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

const STATUS_STYLE: Record<LeadStatus, string> = {
  new:            "bg-muted text-muted-foreground",
  no_answer:      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  voicemail:      "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  callback:       "bg-primary/10 text-primary",
  not_interested: "bg-muted text-muted-foreground",
  wrong_number:   "bg-muted text-muted-foreground",
  do_not_call:    "bg-destructive/10 text-destructive",
  booked:         "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

type Toast = { text: string; tone: "ok" | "error" };

/* ────────────────────────────────────────────────────────────────────────────
   Screen
──────────────────────────────────────────────────────────────────────────── */
export function CallList({ initial, canManage = false }: { initial: CallListInitial; canManage?: boolean }) {
  const [tab, setTab] = useState<Tab>("todo");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [leads, setLeads] = useState<CallLead[]>(initial.leads);
  const [total, setTotal] = useState(initial.total);
  const [counts, setCounts] = useState<TabCounts>(initial.counts);
  const [stats, setStats] = useState<MotivationStats>(initial.stats);
  const [selectedId, setSelectedId] = useState<string | null>(initial.leads[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Outcome | "delete" | null>(null);
  const [notes, setNotes] = useState<Record<string, CallLeadNote[]>>({});
  const [calls, setCalls] = useState<Record<string, CallActivity[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const reqId = useRef(0);
  const pendingSelect = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notesRequested = useRef(new Set<string>());
  const live = useRef({ tab, q: debouncedQ, selectedId, busy });
  live.current = { tab, q: debouncedQ, selectedId, busy };

  const lead = useMemo(() => leads.find((l) => l.id === selectedId) ?? null, [leads, selectedId]);
  const searching = debouncedQ.trim() !== "";
  const noLeadsAtAll = counts.todo + counts.callbacks + counts.done === 0;

  const say = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 7000 : 3500);
  }, []);

  /** Load the list for a tab / search, keeping the current lead selected when it is still there. */
  const load = useCallback(async (nextTab: Tab, nextQ: string, keepId?: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/call-leads?tab=${nextTab}&q=${encodeURIComponent(nextQ)}`);
      const data = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (!res.ok) { say(data.error ?? "Couldn't load the leads.", "error"); return; }
      const next = data.leads as CallLead[];
      setLeads(next);
      setTotal(data.total as number);
      setCounts(data.counts as TabCounts);
      const wanted = pendingSelect.current;
      pendingSelect.current = null;
      setSelectedId((prev) => {
        const want = wanted ?? keepId ?? prev;
        return want && next.some((l) => l.id === want) ? want : next[0]?.id ?? null;
      });
    } catch {
      if (id === reqId.current) say("Couldn't load the leads. Check your connection.", "error");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [say]);

  // A reminder links here with ?lead=<id>: open the Callbacks tab with that lead selected
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    pendingSelect.current = id;
    setQ(""); setDebouncedQ("");
    if (live.current.tab === "callbacks") load("callbacks", "", id);
    else setTab("callbacks");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Reload when the tab or search changes (the first render uses the server's data)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    load(tab, debouncedQ);
  }, [tab, debouncedQ, load]);

  // Refresh every minute so "callback due" stays honest
  useEffect(() => {
    const t = setInterval(() => {
      if (!live.current.busy) load(live.current.tab, live.current.q, live.current.selectedId);
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  /** Load a lead's notes and the calls DialSheet logged on it. */
  const loadHistory = useCallback(async (leadId: string) => {
    try {
      const r = await fetch(`/api/call-leads/${leadId}/notes`);
      if (!r.ok) return null;
      const d = await r.json();
      if (d?.notes) setNotes((n) => ({ ...n, [leadId]: d.notes }));
      if (Array.isArray(d?.calls)) setCalls((c) => ({ ...c, [leadId]: d.calls }));
      return d as { notes?: CallLeadNote[]; calls?: CallActivity[] };
    } catch { return null; }
  }, []);

  // Fetch the selected lead's history once
  useEffect(() => {
    if (!selectedId || notesRequested.current.has(selectedId)) return;
    notesRequested.current.add(selectedId);
    loadHistory(selectedId).then((d) => { if (!d) notesRequested.current.delete(selectedId); });
  }, [selectedId, loadHistory]);

  // DialSheet reports a call a couple of minutes after it ends, usually while Jan is on the next one:
  // when he comes back to this tab, refresh the selected lead's calls so a new one shows up.
  useEffect(() => {
    if (!selectedId) return;
    const onFocus = () => { void loadHistory(selectedId); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [selectedId, loadHistory]);

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(copiedTimer.current); }, []);

  const copyNumber = useCallback(async (l: CallLead) => {
    const { copy } = parsePhone(l.phone);
    if (!copy) { say("This lead has no number to copy.", "error"); return; }
    if (await copyText(copy)) {
      setCopiedId(l.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2200);
    } else {
      say("Couldn't copy. Select the number and copy it by hand.", "error");
    }
  }, [say]);

  // "C" copies the number when you're not typing in a box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (lead) { e.preventDefault(); copyNumber(lead); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, copyNumber]);

  /** Send a note or call outcome. Resolves true on success so the form can close. */
  const submit = useCallback(async (
    outcome: Outcome,
    extra: { when?: string; with?: SalesCallWith; contact_name?: string; email?: string; slot?: boolean } = {},
  ): Promise<boolean> => {
    if (!lead || live.current.busy) return false;
    const leadId = lead.id;
    // Where to go next: the lead after this one in the current list
    const at = leads.findIndex((l) => l.id === leadId);
    const nextId = leads[at + 1]?.id ?? leads[at - 1]?.id ?? null;

    setBusy(outcome);
    try {
      const res = await fetch(`/api/call-leads/${leadId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note: drafts[leadId] ?? "", ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data.error ?? "That didn't save. Try again.", "error"); return false; }

      if (data.stats) setStats(data.stats as MotivationStats);
      if (data.counts) setCounts(data.counts as TabCounts);
      if (data.note) setNotes((n) => ({ ...n, [leadId]: [data.note as CallLeadNote, ...(n[leadId] ?? [])] }));
      setDrafts((d) => ({ ...d, [leadId]: "" }));
      say(data.warning ? String(data.warning) : outcome === "note" ? "Note saved." : `${OUTCOME_LABEL[outcome]}. Next lead.`, data.warning ? "error" : "ok");

      if (outcome === "note") {
        setLeads((ls) => ls.map((l) => (l.id === leadId ? (data.lead as CallLead) : l)));
      } else {
        await load(live.current.tab, live.current.q, nextId);
        // `load` keeps a still-listed lead selected; when this one left the list, move on
        setSelectedId((cur) => (cur === leadId && nextId ? nextId : cur));
      }
      return true;
    } catch {
      say("Couldn't reach the server. Check your connection and try again.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  }, [lead, leads, drafts, load, say]);

  /** Delete the selected lead for good, then move on to the next one. */
  const removeLead = useCallback(async () => {
    if (!lead || live.current.busy) return;
    const leadId = lead.id;
    const extras = [
      lead.status === "booked" ? "The booked sales call stays in the calendar and pipeline." : null,
      "If you import the sheet again, this lead will be added back as new.",
    ].filter(Boolean).join(" ");
    if (!window.confirm(`Delete ${lead.business_name}? Its notes and call history are deleted too, and this can't be undone.\n\n${extras}`)) return;

    const at = leads.findIndex((l) => l.id === leadId);
    const nextId = leads[at + 1]?.id ?? leads[at - 1]?.id ?? null;
    setBusy("delete");
    try {
      const res = await fetch(`/api/call-leads/${leadId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data.error ?? "Couldn't delete that lead.", "error"); return; }
      if (data.counts) setCounts(data.counts as TabCounts);
      setLeads((ls) => ls.filter((l) => l.id !== leadId));
      setNotes((n) => { const { [leadId]: _gone, ...rest } = n; return rest; });
      setDrafts((d) => { const { [leadId]: _gone, ...rest } = d; return rest; });
      setSelectedId(nextId);
      say("Lead deleted.");
      void load(live.current.tab, live.current.q, nextId);
    } catch {
      say("Couldn't reach the server. Check your connection and try again.", "error");
    } finally {
      setBusy(null);
    }
  }, [lead, leads, load, say]);

  const dueNow = counts.due;

  return (
    <div className="space-y-4">
      {/* Today strip */}
      <div className="flex flex-wrap items-stretch gap-3">
        <StatTile label="Calls today" value={stats.calls} />
        <StatTile label="Callbacks set" value={stats.callbacks} />
        <StatTile label="Sales calls booked" value={stats.booked} gold />
        <div className="ml-auto flex items-center gap-2">
          <AlertsButton />
          {canManage && (
            <Link href="/call-list/import" className={btnCls}>
              <Upload size={13} /> Import leads
            </Link>
          )}
        </div>
      </div>

      {dueNow > 0 && (
        <button
          type="button"
          onClick={() => { setQ(""); setDebouncedQ(""); setTab("callbacks"); }}
          className="flex w-full items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-left text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
        >
          <CalendarClock size={15} />
          {dueNow} callback{dueNow === 1 ? " is" : "s are"} due now. Open Callbacks
        </button>
      )}

      {noLeadsAtAll && !searching ? (
        <div className="rounded-xl border bg-card p-10 text-center ring-1 ring-foreground/5">
          <p className="text-base font-semibold">No leads in the call list yet</p>
          {canManage ? (
            <>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Copy the rows from the scraped Google Sheet (include the header row) and paste them in. Each lead
                keeps its own notes and call history.
              </p>
              <Link href="/call-list/import" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97]">
                <Upload size={14} /> Import leads
              </Link>
            </>
          ) : (
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              There are no leads to call yet. Ryan or Lachlan will add the list, then it shows up here.
            </p>
          )}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* ── The list ─────────────────────────────────────────────── */}
          <section className="flex flex-col overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/5 lg:sticky lg:top-0 lg:h-[calc(100vh-15rem)] lg:min-h-[420px]">
            <div className="space-y-3 border-b p-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name or number"
                  aria-label="Search leads"
                  className={cn(inputCls, "pl-8")}
                />
              </div>
              {searching ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">Search results ({total.toLocaleString("en-AU")})</span>
                  <button type="button" onClick={() => setQ("")} className="font-semibold text-primary hover:underline">Clear</button>
                </div>
              ) : (
                <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
                  {(["todo", "callbacks", "done"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      type="button"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-md px-2 py-1.5 text-xs font-semibold transition-all",
                        tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {TAB_LABEL[t]} <span className="tabular-nums opacity-70">{counts[t].toLocaleString("en-AU")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {loading && (
                <div className="absolute right-3 top-2 text-muted-foreground"><Loader2 size={14} className="animate-spin" /></div>
              )}
              {leads.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {searching ? "No leads match that search." : tab === "todo" ? "Nothing left to call. Nice work." : tab === "callbacks" ? "No callbacks waiting." : "Nothing finished yet."}
                </p>
              ) : (
                <ul className="divide-y">
                  {leads.map((l) => (
                    <LeadRow key={l.id} lead={l} selected={l.id === selectedId} onSelect={() => setSelectedId(l.id)} />
                  ))}
                </ul>
              )}
              {total > leads.length && (
                <p className="border-t p-3 text-center text-xs text-muted-foreground">
                  Showing the first {leads.length} of {total.toLocaleString("en-AU")}. Search to find a specific business.
                </p>
              )}
            </div>
          </section>

          {/* ── The lead ─────────────────────────────────────────────── */}
          {lead ? (
            <LeadDetail
              key={lead.id}
              lead={lead}
              history={notes[lead.id]}
              calls={calls[lead.id]}
              draft={drafts[lead.id] ?? ""}
              onDraft={(v) => setDrafts((d) => ({ ...d, [lead.id]: v }))}
              busy={busy}
              copied={copiedId === lead.id}
              onCopy={() => copyNumber(lead)}
              onSubmit={submit}
              onDelete={canManage ? removeLead : undefined}
              canType={canManage}
            />
          ) : (
            <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/5">
              {leads.length ? "Pick a lead from the list." : "Nothing to show here."}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-bottom-2",
            toast.tone === "error" ? "bg-destructive text-white" : "bg-foreground text-background",
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   List row
──────────────────────────────────────────────────────────────────────────── */
function LeadRow({ lead, selected, onSelect }: { lead: CallLead; selected: boolean; onSelect: () => void }) {
  const phone = parsePhone(lead.phone);
  const overdue = lead.status === "callback" && lead.callback_at && new Date(lead.callback_at).getTime() <= Date.now();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          "flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors",
          selected ? "bg-primary/5" : "hover:bg-muted/40",
        )}
      >
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", selected ? "bg-primary" : "bg-transparent")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{lead.business_name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[lead.category, phone.display].filter(Boolean).join(" · ")}
          </span>
          {lead.status === "callback" && lead.callback_at && (
            <span className={cn("mt-0.5 block text-xs font-semibold", overdue ? "text-destructive" : "text-primary")}>
              {overdue ? "Due now · " : ""}{formatSydney(lead.callback_at)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {lead.status !== "new" && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_STYLE[lead.status])}>
              {STATUS_LABEL[lead.status]}
            </span>
          )}
          {lead.attempts > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground">{lead.attempts} {lead.attempts === 1 ? "call" : "calls"}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function StatTile({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <div className="min-w-[130px] rounded-xl border bg-card px-4 py-2.5 ring-1 ring-foreground/5">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold tabular-nums leading-tight", gold && value > 0 && "text-amber-600")}>{value}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Lead detail — number, notes, outcomes
──────────────────────────────────────────────────────────────────────────── */
type Panel = null | "callback" | "booked";

function LeadDetail({
  lead, history, calls, draft, onDraft, busy, copied, onCopy, onSubmit, onDelete, canType,
}: {
  lead: CallLead;
  history: CallLeadNote[] | undefined;
  /** Calls logged on this lead by DialSheet. */
  calls: CallActivity[] | undefined;
  draft: string;
  onDraft: (v: string) => void;
  busy: Outcome | "delete" | null;
  copied: boolean;
  onCopy: () => void;
  onSubmit: (outcome: Outcome, extra?: { when?: string; with?: SalesCallWith; contact_name?: string; email?: string; slot?: boolean }) => Promise<boolean>;
  /** Managers can type any time; everyone else books from the offered times. */
  canType: boolean;
  onDelete?: () => void;
}) {
  const phone = parsePhone(lead.phone);
  // The time where the clinic is. Set after mount (and refreshed each minute) so the server and browser agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // He just made a call but hasn't logged how it went: nudge (45 minutes, then it's old news)
  const awaitingResult = useMemo(() => {
    if (!now) return null;
    const last = (calls ?? []).find((c) => c.direction === "outgoing" && c.started_at);
    if (!last?.started_at) return null;
    const at = Date.parse(last.started_at);
    if (Number.isNaN(at) || now.getTime() - at > 45 * 60_000) return null;
    const logged = lead.last_called_at ? Date.parse(lead.last_called_at) : 0;
    return at > logged ? last : null;
  }, [calls, now, lead.last_called_at]);

  // Notes and calls on one timeline, newest first
  const timeline = useMemo(() => {
    type Item = { kind: "note"; at: number; note: CallLeadNote } | { kind: "call"; at: number; call: CallActivity };
    const items: Item[] = [
      ...(history ?? []).map((note): Item => ({ kind: "note", at: Date.parse(note.occurred_at), note })),
      ...(calls ?? []).map((call): Item => ({ kind: "call", at: Date.parse(call.started_at ?? call.created_at), call })),
    ];
    return items.sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [history, calls]);

  const clinic = useMemo(() => (now ? clinicTime({ address: lead.address, phone: lead.phone }, now) : null), [now, lead.address, lead.phone]);
  const site = safeUrl(lead.website);
  const maps = safeUrl(lead.google_maps_url);
  const [panel, setPanel] = useState<Panel>(null);
  const isBooked = lead.status === "booked";
  const stop = lead.status === "do_not_call" || lead.status === "wrong_number";

  return (
    <section className="space-y-4">
      {/* Header + number */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight">{lead.business_name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {lead.category && <span>{lead.category}</span>}
              {lead.rating != null && (
                <span className="inline-flex items-center gap-1">
                  <Star size={12} className="fill-amber-400 text-amber-400" />
                  {lead.rating.toFixed(1)}{lead.review_count != null && ` (${lead.review_count.toLocaleString("en-AU")} reviews)`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("rounded-full px-2.5 py-1 font-bold", STATUS_STYLE[lead.status])}>{STATUS_LABEL[lead.status]}</span>
            {lead.attempts > 0 && (
              <span className="text-muted-foreground">
                {lead.attempts} {lead.attempts === 1 ? "call" : "calls"}
                {lead.last_called_at && ` · last ${formatSydney(lead.last_called_at)}`}
              </span>
            )}
          </div>
        </div>

        {stop && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            {lead.status === "do_not_call" ? "Do not call this number again." : "Marked as a wrong number."}
          </p>
        )}
        {lead.status === "callback" && lead.callback_at && (
          <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
            Callback promised for {formatSydney(lead.callback_at)} Sydney time. Press Callback to reschedule, or log the result below.
          </p>
        )}

        <button
          type="button"
          onClick={onCopy}
          disabled={!phone.copy}
          title="Copy this number for the dialer (shortcut: C)"
          className={cn(
            "group mt-4 flex w-full items-center justify-between gap-3 rounded-xl border-2 px-5 py-4 text-left transition-all active:scale-[0.99]",
            copied ? "border-emerald-500 bg-emerald-500/10" : "border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10",
          )}
        >
          <span>
            <span className="block font-mono text-3xl font-bold tracking-tight tabular-nums">{phone.display || "No number"}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {copied ? `Copied ${phone.copy}` : phone.ok ? `Click to copy ${phone.copy}` : "Click to copy as typed"}
            </span>
          </span>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold", copied ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground")}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
        {clinic && (
          <p
            className={cn(
              "mt-2 flex items-center gap-1.5 text-xs font-semibold",
              clinic.hours === "open" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
            )}
            title="Worked out from the clinic's address or phone area code. Clinics often keep different hours."
          >
            <Clock size={12} /> {clinic.summary}
          </p>
        )}
        {!phone.ok && phone.display && (
          <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
            This number doesn&apos;t look complete. Check it before dialling.
          </p>
        )}

        {/* About the business */}
        <dl className="mt-4 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
          {lead.address && (
            <Info icon={<MapPin size={14} />} label="Address">
              {lead.address}
              {maps && (
                <a href={maps} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
                  Maps <ExternalLink size={11} />
                </a>
              )}
            </Info>
          )}
          {lead.website && (
            <Info icon={<Globe size={14} />} label="Website">
              {site ? (
                <>
                  <a href={site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {hostOf(site)} <ExternalLink size={11} />
                  </a>
                  {lead.extra?.[WEBSITE_FROM_KEY] && (
                    <span className="ml-2 text-[11px] text-muted-foreground" title="Worked out from the sheet, not confirmed. Check it's the right site.">
                      {lead.extra[WEBSITE_FROM_KEY] === "email" ? "found from their email" : "found in the sheet"}
                    </span>
                  )}
                </>
              ) : lead.website}
            </Info>
          )}
          {lead.email && (
            <Info icon={<Mail size={14} />} label="Email">
              {EMAIL_RE.test(lead.email) ? <a href={`mailto:${lead.email}`} className="font-medium text-primary hover:underline">{lead.email}</a> : lead.email}
            </Info>
          )}
        </dl>
        {Object.keys(lead.extra ?? {}).some((k) => !k.startsWith("_")) && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">More from the sheet</summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {Object.entries(lead.extra).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] font-semibold text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>

      {/* Notes + outcome */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        {awaitingResult && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <PhoneOutgoing size={14} />
            DialSheet logged a call to this number at {formatSydney(awaitingResult.started_at)}
            {awaitingResult.call_type === "answered" && awaitingResult.duration_seconds ? ` (${formatDuration(awaitingResult.duration_seconds)})` : ""}. Log how it went below.
          </p>
        )}
        <label htmlFor="call-notes" className="mb-1.5 block text-xs font-semibold text-foreground/80">
          Call notes
        </label>
        <textarea
          id="call-notes"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="What did they say? Who answers the phones, missed calls, how busy they are, best time to call…"
          className={cn(inputCls, "min-h-[110px] resize-y")}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Your notes are saved with whichever result you press below.</p>
          <button
            type="button"
            onClick={() => { void onSubmit("note"); }}
            disabled={!draft.trim() || busy !== null}
            className={btnCls}
          >
            {busy === "note" ? <Loader2 size={13} className="animate-spin" /> : null} Save note only
          </button>
        </div>

        <div className="mt-4 border-t pt-4">
          <div className="mb-2 text-xs font-semibold text-foreground/80">How did the call go?</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <OutcomeButton icon={<PhoneMissed size={14} />} label="No answer" busy={busy === "no_answer"} disabled={busy !== null} onClick={() => { void onSubmit("no_answer"); }} />
            <OutcomeButton icon={<Voicemail size={14} />} label="Voicemail" busy={busy === "voicemail"} disabled={busy !== null} onClick={() => { void onSubmit("voicemail"); }} />
            <OutcomeButton icon={<ThumbsDown size={14} />} label="Not interested" busy={busy === "not_interested"} disabled={busy !== null} onClick={() => { void onSubmit("not_interested"); }} />
            <OutcomeButton icon={<XCircle size={14} />} label="Wrong number" busy={busy === "wrong_number"} disabled={busy !== null} onClick={() => { void onSubmit("wrong_number"); }} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPanel(panel === "callback" ? null : "callback")}
              disabled={busy !== null}
              aria-expanded={panel === "callback"}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50",
                panel === "callback" ? "border-primary bg-primary/10 text-primary" : "border-primary/30 text-primary hover:border-primary hover:bg-primary/5",
              )}
            >
              <CalendarClock size={15} /> Set a callback
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "booked" ? null : "booked")}
              disabled={busy !== null || isBooked}
              aria-expanded={panel === "booked"}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition-all active:scale-[0.98] disabled:opacity-60",
                "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <CalendarCheck size={15} /> {isBooked ? "Sales call booked" : "Book a sales call"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => { if (window.confirm(`Mark ${lead.business_name} as do not call?`)) void onSubmit("do_not_call"); }}
            disabled={busy !== null || lead.status === "do_not_call"}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Ban size={12} /> They asked not to be called again
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null}
              className="ml-4 mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              {busy === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete this lead
            </button>
          )}

          {panel === "callback" && (
            <CallbackForm
              busy={busy === "callback"}
              onCancel={() => setPanel(null)}
              onSave={async (iso) => { if (await onSubmit("callback", { when: iso })) setPanel(null); }}
            />
          )}
          {panel === "booked" && (
            <BookingForm
              lead={lead}
              hasNote={draft.trim() !== ""}
              busy={busy === "booked"}
              canType={canType}
              onCancel={() => setPanel(null)}
              onSave={async (extra) => {
                const ok = await onSubmit("booked", extra);
                if (ok) setPanel(null);
                return ok;
              }}
            />
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h3 className="mb-3 text-sm font-semibold">History</h3>
        {!history ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls or notes yet. Anything you log shows up here.</p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((item) => {
              if (item.kind === "note") {
                const n = item.note;
                return (
                  <li key={`n-${n.id}`} className="border-l-2 border-primary/20 pl-3">
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5 font-bold text-foreground/80">{OUTCOME_LABEL[n.outcome]}</span>
                      <span>{formatSydney(n.occurred_at)}</span>
                      <span>· {actorDisplayName(n.actor as Actor, n.created_by)}</span>
                    </div>
                    {n.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>}
                  </li>
                );
              }
              const c = item.call;
              const Icon = c.direction === "incoming" ? (c.call_type === "missed" ? PhoneMissed : PhoneIncoming) : PhoneOutgoing;
              return (
                <li key={`c-${c.id}`} className="border-l-2 border-sky-500/40 pl-3">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-bold text-sky-700 dark:text-sky-300">
                      <Icon size={11} /> {describeCall(c)}
                    </span>
                    <span>{formatSydney(c.started_at ?? c.created_at)}</span>
                  </div>
                  {c.disposition && <p className="mt-1 text-xs"><span className="font-semibold">DialSheet outcome:</span> {c.disposition}</p>}
                  {c.notes && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.notes}</p>}
                  {c.summary && <p className="mt-1 whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-xs"><span className="font-semibold">AI summary:</span> {c.summary}</p>}
                  {c.next_steps && <p className="mt-1 whitespace-pre-wrap break-words text-xs"><span className="font-semibold">Suggested next step:</span> {c.next_steps}</p>}
                  {c.recording_url && (
                    <a href={c.recording_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">Open recording</a>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function Info({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground" title={label}>{icon}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function OutcomeButton({ icon, label, onClick, busy, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; busy: boolean; disabled: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center justify-center gap-1.5 rounded-lg border bg-background px-3 py-2.5 text-[13px] font-semibold transition-all hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50">
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon} {label}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Date/time picker that always means Sydney time
──────────────────────────────────────────────────────────────────────────── */
function SydneyTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [picks] = useState(() => quickTimes());
  const iso = value ? sydneyWallToISO(value) : null;
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-foreground/80">
        When <span className="font-normal text-muted-foreground">(Sydney time)</span>
      </label>
      <input
        type="datetime-local"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {picks.map((p) => (
          <button key={p.label} type="button" onClick={() => onChange(p.value)} className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary">
            {p.label}
          </button>
        ))}
      </div>
      {iso && (
        <p className="mt-2 text-xs font-semibold text-primary">
          {formatSydney(iso)} Sydney time
          {!viewerIsOnSydneyTime(iso) && <span className="font-normal text-muted-foreground"> · that is {formatViewerLocal(iso)} where you are</span>}
        </p>
      )}
    </div>
  );
}

/** Bring a freshly opened form into view — it opens below the fold on most screens. */
function useScrollIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  return ref;
}

function CallbackForm({ busy, onCancel, onSave }: {
  busy: boolean; onCancel: () => void; onSave: (iso: string) => void | Promise<void>;
}) {
  const [when, setWhen] = useState("");
  const iso = when ? sydneyWallToISO(when) : null;
  const ref = useScrollIntoView<HTMLFormElement>();
  return (
    <form
      ref={ref}
      className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4 animate-in fade-in slide-in-from-top-1"
      onSubmit={(e) => { e.preventDefault(); if (iso) void onSave(iso); }}
    >
      <p className="text-sm font-semibold">When should we call them back?</p>
      <SydneyTimeField value={when} onChange={setWhen} />
      <p className="text-xs text-muted-foreground">It appears in your Callbacks tab and flags when it&apos;s due. Your notes above are saved with it.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={!iso || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Save callback
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnCls}>Cancel</button>
      </div>
    </form>
  );
}

function BookingForm({ lead, hasNote, busy, canType, onCancel, onSave }: {
  lead: CallLead; hasNote: boolean; busy: boolean; canType: boolean; onCancel: () => void;
  onSave: (extra: { when: string; with: SalesCallWith; contact_name?: string; email?: string; slot?: boolean }) => boolean | Promise<boolean>;
}) {
  // Normally he taps a time from the free slots. Typing any time is only for managers, or when no hours are set up yet.
  const [manual, setManual] = useState(false);
  const [unavailable, setUnavailable] = useState<null | "not-set-up" | "error">(null);
  const [pick, setPick] = useState<Picked | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [when, setWhen] = useState("");
  const [withWhom, setWithWhom] = useState<SalesCallWith | "">("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState(lead.email ?? "");
  const ref = useScrollIntoView<HTMLFormElement>();

  const typing = manual || unavailable !== null;
  const iso = when ? sydneyWallToISO(when) : null;
  const ready = typing ? !!iso && withWhom !== "" : !!pick;
  const who = typing
    ? (withWhom === "either" ? "Ryan or Lachlan" : withWhom ? withWhom.charAt(0).toUpperCase() + withWhom.slice(1) : "Ryan or Lachlan")
    : pick ? PERSON_LABEL[pick.person] : "Ryan or Lachlan";
  const typedClinic = typing && iso ? clinicClockForSlot(lead, iso) : null;

  return (
    <form
      ref={ref}
      className="mt-4 space-y-4 rounded-xl border bg-muted/30 p-4 animate-in fade-in slide-in-from-top-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const extras = { contact_name: contact.trim() || undefined, email: email.trim() || undefined };
        if (typing) {
          if (iso && withWhom) await onSave({ when: iso, with: withWhom, ...extras });
        } else if (pick) {
          const ok = await onSave({ when: pick.start, with: pick.person, slot: true, ...extras });
          // Most likely someone just took that time: reload the free times.
          if (!ok) { setPick(null); setRefreshKey((k) => k + 1); }
        }
      }}
    >
      <p className="text-sm font-semibold">Book the sales call</p>

      {typing ? (
        <>
          {unavailable === "not-set-up" && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Booking times haven&apos;t been set up yet, so pick any time and Ryan or Lachlan will confirm it.
            </p>
          )}
          {unavailable === "error" && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              Couldn&apos;t load the free times just now. You can pick a time yourself, but it may be refused if it clashes.
            </p>
          )}
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Who is it with?</span>
            <div role="radiogroup" aria-label="Who is the sales call with" className="inline-flex gap-0.5 rounded-full border bg-background p-[3px]">
              {([["ryan", "Ryan"], ["lachlan", "Lachlan"], ["either", "Either"]] as [SalesCallWith, string][]).map(([v, label]) => (
                <label key={v} className="relative block">
                  <input type="radio" name="with" value={v} checked={withWhom === v} onChange={() => setWithWhom(v)} className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" />
                  <span className="block rounded-full px-4 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <SydneyTimeField value={when} onChange={setWhen} />
          {typedClinic && (
            <p className="text-xs font-semibold text-primary">That&apos;s {typedClinic.clock} for this {typedClinic.state} clinic.</p>
          )}
          {manual && unavailable === null && (
            <button type="button" onClick={() => { setManual(false); setWhen(""); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline">
              Back to the free times
            </button>
          )}
        </>
      ) : (
        <SlotPicker
          lead={lead}
          value={pick}
          onPick={setPick}
          refreshKey={refreshKey}
          onUnavailable={setUnavailable}
          onManual={canType ? () => setManual(true) : undefined}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground/80">Who will be on the call?</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Dr Sarah Chen" className={inputCls} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground/80">Their email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sarah@clinic.com.au" className={inputCls} />
        </div>
      </div>

      <p className={cn("rounded-lg px-3 py-2 text-xs", hasNote ? "bg-muted text-muted-foreground" : "bg-amber-500/10 font-semibold text-amber-800 dark:text-amber-300")}>
        {hasNote
          ? `${who} will see your notes and everything logged on this lead before the call.`
          : `Add what you learned in the notes box first (pain points, who owns the phones). ${who} reads it before the call.`}
      </p>

      <div className="flex gap-2">
        <button type="submit" disabled={!ready || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Book sales call
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnCls}>
          <X size={13} /> Cancel
        </button>
      </div>
    </form>
  );
}

/** Turn on desktop notifications so callback reminders reach him even when this tab isn't in front. */
function AlertsButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => { setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission); }, []);
  if (perm === null || perm === "unsupported") return null;
  if (perm === "granted") {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><Bell size={12} /> Callback alerts on</span>;
  }
  if (perm === "denied") {
    return <span className="text-xs text-muted-foreground" title="Allow notifications for this site in your browser settings to turn them on.">Desktop alerts are blocked in this browser</span>;
  }
  return (
    <button
      type="button"
      onClick={async () => { try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ } }}
      className={btnCls}
    >
      <Bell size={13} /> Turn on callback alerts
    </button>
  );
}
