"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { defaultState, restoreState, type QuoteState } from "@/lib/hq/quote-config";
import type { ClientQuoteView, QuoteClient, QuoteClientApi } from "@/lib/hq/client-quotes";
import { formatSydney } from "@/lib/hq/sydney-time";
import { ArrowRight, ExternalLink, Link2, Loader2, Save, Search, Unlink } from "lucide-react";

/**
 * Ties the quote on screen to a CRM client (the one made when the sales call was booked).
 * A linked quote is kept on the server with the client and can be pushed to that client's
 * application, so what was agreed on the call isn't typed again.
 */

const LINK_KEY = "ivory.quote.client";

const STAGE_LABEL: Record<string, string> = {
  call_booked: "Call booked", document_sent: "Document sent", quoted: "Quoted", approved: "Approved",
  onboarding: "Onboarding", final_testing: "Final testing", activated: "Activated", live_client: "Live",
  closed_lost: "Lost", paused: "Paused",
};

const inputCls = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";
const btnCls = "inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

type Linked = {
  id: string;
  name: string;
  /** null until a quote has been saved for this client. */
  savedAt: string | null;
  savedBy: string | null;
  application: ClientQuoteView["application"];
};

function readStoredId(): string | null {
  try { return localStorage.getItem(LINK_KEY); } catch { return null; }
}
function storeId(id: string | null) {
  try { if (id) localStorage.setItem(LINK_KEY, id); else localStorage.removeItem(LINK_KEY); } catch { /* storage blocked */ }
}

const who = (email: string | null) => (email ? email.split("@")[0] : null);

export function ClientLink({ api, state, onReplace, onClinicName, flash, initialClientId }: {
  api: QuoteClientApi;
  state: QuoteState;
  /** Put a whole quote on screen. */
  onReplace: (s: QuoteState) => void;
  /** Fill in the clinic name only. */
  onClinicName: (name: string) => void;
  flash: (msg: string) => void;
  initialClientId?: string;
}) {
  const [linked, setLinked] = useState<Linked | null>(null);
  const [busy, setBusy] = useState<null | "open" | "save" | "push">(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QuoteClient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /** The quote as last saved to this client, to tell whether the screen has moved on from it. */
  const savedJson = useRef<string | null>(null);
  const stateJson = JSON.stringify(state);
  const dirty = savedJson.current === null || savedJson.current !== stateJson;

  /** Find the clients to pick from (debounced while typing). */
  useEffect(() => {
    if (!listOpen) return;
    let stale = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (!stale) setResults(r.ok ? r.clients : []);
      } catch { if (!stale) setResults([]); }
      finally { if (!stale) setSearching(false); }
    }, q ? 250 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [q, listOpen, api]);

  const adopt = useCallback((view: ClientQuoteView) => {
    setLinked({
      id: view.client.id,
      name: view.client.company_name,
      savedAt: view.updatedAt,
      savedBy: view.updatedBy,
      application: view.application,
    });
    storeId(view.client.id);
  }, []);

  /** Link to a client; bring their saved quote up, or start one in their name. */
  const link = useCallback(async (clientId: string, opts: { keepScreen?: boolean } = {}) => {
    setBusy("open");
    try {
      const r = await api.open(clientId);
      if (!r.ok) { flash(r.error); return; }
      const { view } = r;

      if (opts.keepScreen) {
        // Re-linking after a refresh: the draft on screen is the user's latest work, so leave it.
        adopt(view);
        if (view.state) savedJson.current = JSON.stringify(view.state);
        return;
      }

      const onScreen = state.clinic.trim();
      if (view.state) {
        const same = JSON.stringify(state) === JSON.stringify(view.state);
        if (!same && onScreen && !window.confirm(`Open ${view.client.company_name}'s saved quote? That replaces the quote on screen${onScreen ? ` ("${onScreen}")` : ""}.`)) return;
        onReplace(view.state);
        savedJson.current = JSON.stringify(view.state);
        adopt(view);
        flash(`Opened ${view.client.company_name}'s saved quote`);
        return;
      }

      // No saved quote for this client yet.
      savedJson.current = null;
      if (!onScreen) {
        onClinicName(view.client.company_name);
      } else if (onScreen.toLowerCase() !== view.client.company_name.toLowerCase()) {
        if (!window.confirm(`The quote on screen is for "${onScreen}". Start a fresh quote for ${view.client.company_name}?`)) return;
        onReplace({ ...defaultState(), clinic: view.client.company_name });
      }
      adopt(view);
      flash(`Linked to ${view.client.company_name}. Save it to keep it with them.`);
    } catch {
      flash("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }, [api, adopt, flash, onClinicName, onReplace, state]);

  // Come in with a client already chosen (?client=…), or remember the last one across a refresh.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialClientId) void link(initialClientId);
    else { const id = readStoredId(); if (id) void link(id, { keepScreen: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function unlink() {
    setLinked(null);
    savedJson.current = null;
    storeId(null);
    setListOpen(false);
  }

  async function save() {
    if (!linked) return;
    setBusy("save");
    try {
      const r = await api.save(linked.id, restoreState(state));
      if (!r.ok) { flash(r.error); return; }
      savedJson.current = JSON.stringify(state);
      setLinked((l) => l && { ...l, savedAt: r.updatedAt, savedBy: null });
      flash(`Saved to ${linked.name}`);
    } catch { flash("Couldn't save. Try again."); }
    finally { setBusy(null); }
  }

  async function push() {
    if (!linked) return;
    const status = linked.application?.status;
    if (status && status !== "draft" && !window.confirm(`${linked.name}'s application is already ${status}. Replace its products and price with this quote?`)) return;
    setBusy("push");
    try {
      const r = await api.push(linked.id, restoreState(state));
      if (!r.ok) { flash(r.error); return; }
      savedJson.current = JSON.stringify(state);
      setLinked((l) => l && { ...l, savedAt: new Date().toISOString(), savedBy: null, application: { id: r.applicationId, status: r.status, pushedAt: new Date().toISOString() } });
      flash(`${r.created ? "Started" : "Updated"} the application with ${r.products} product${r.products === 1 ? "" : "s"}.`);
    } catch { flash("Couldn't push to the application. Try again."); }
    finally { setBusy(null); }
  }

  /* ── Not linked: pick a client ─────────────────────────────────────────── */
  if (!linked) {
    return (
      <section className="rounded-xl border bg-card p-4 ring-1 ring-foreground/5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Link2 size={14} /> Client</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick the client from the sales call. Their quote is kept with them and can go straight to their application.
            </p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="quote-client-list"
              aria-label="Search clients"
              className={cn(inputCls, "pl-8")}
              placeholder={busy === "open" ? "Opening…" : "Search clients…"}
              value={q}
              disabled={busy === "open"}
              onFocus={() => setListOpen(true)}
              onBlur={() => setTimeout(() => setListOpen(false), 150)}
              onChange={(e) => { setQ(e.target.value); setListOpen(true); }}
            />
            {listOpen && (
              <ul id="quote-client-list" role="listbox" className="absolute right-0 z-30 mt-1 max-h-72 w-[26rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
                {searching && results === null && <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>}
                {results?.length === 0 && !searching && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">{q ? "No clients match." : "No clients yet. One is made when a sales call is booked."}</li>
                )}
                {results?.map((c) => (
                  <li key={c.id} role="option" aria-selected="false">
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setListOpen(false); setQ(""); void link(c.id); }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="min-w-0 truncate font-medium">{c.company_name}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        {c.hasQuote && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">Quote</span>}
                        {c.applicationId && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">Application</span>}
                        {c.stage && <span>{STAGE_LABEL[c.stage] ?? c.stage}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    );
  }

  /* ── Linked ────────────────────────────────────────────────────────────── */
  const app = linked.application;
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 ring-1 ring-primary/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Link2 size={14} className="text-primary" /> <span className="truncate">{linked.name}</span></h2>
          <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {linked.savedAt === null
              ? "Not saved to this client yet."
              : dirty
                ? "You have changes that aren't saved to this client."
                : `Saved ${formatSydney(linked.savedAt)}${who(linked.savedBy) ? ` by ${who(linked.savedBy)}` : ""}.`}
            {app && (
              <>
                {" "}Application: <span className="font-semibold">{app.status}</span>
                {app.pushedAt ? `, quote pushed ${formatSydney(app.pushedAt)}` : ", no quote pushed yet"}.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={busy !== null} className={btnCls}>
            {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save to client
          </button>
          <button
            type="button"
            onClick={push}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy === "push" ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />} Push to application
          </button>
          {app && (
            <Link href={`/application/${app.id}`} className={btnCls}>
              <ExternalLink size={13} /> Open application
            </Link>
          )}
          <button type="button" onClick={unlink} disabled={busy !== null} className={cn(btnCls, "text-muted-foreground")} title="Stop linking this quote to a client">
            <Unlink size={13} /> Unlink
          </button>
        </div>
      </div>
    </section>
  );
}
