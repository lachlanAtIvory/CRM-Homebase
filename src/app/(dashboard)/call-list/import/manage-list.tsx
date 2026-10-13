"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PurgeScope } from "@/lib/hq/call-lead-admin";
import { Check, Globe, Loader2, Trash2 } from "lucide-react";

type SiteCheck = {
  found: number;
  stillMissing: number;
  sample: { business_name: string; website: string; from: "email" | "column" }[];
};
type PurgePreview = { count: number; called: number; kept: number };

const SCOPES: { id: PurgeScope; title: string; blurb: string }[] = [
  { id: "untouched", title: "Leads nobody has called yet", blurb: "Keeps anything that has a call, a callback or a saved note. Good for clearing out a wrong import." },
  { id: "finished", title: "Finished leads", blurb: "Booked, not interested and wrong number. Do-not-call numbers are kept so they can't come back by accident." },
  { id: "all", title: "The whole list", blurb: "Everything, including notes, call history and do-not-call numbers." },
];

const fmt = (n: number) => n.toLocaleString("en-AU");

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "That didn't work. Try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export function ManageList() {
  return (
    <div className="space-y-4">
      <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Manage the list</h2>
      <WebsitesCard />
      <DeleteCard />
    </div>
  );
}

/* ── Fill in websites on leads already in the list ───────────────────────── */
function WebsitesCard() {
  const [check, setCheck] = useState<SiteCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<number | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "check" : "apply");
    setError("");
    const r = await post<SiteCheck>("/api/call-leads/websites", { dryRun });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    if (dryRun) { setCheck(r.data); setAdded(null); }
    else { setAdded(r.data.found); setCheck(null); }
  }

  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Globe size={14} /> Find missing websites</h3>
        <p className="text-xs text-muted-foreground">
          For leads already in the list that have no website. Looks at their email address and any other link column, and only adds a
          website when it matches the business name. Importing again never changes existing leads, so use this to catch them up.
        </p>
      </div>
      <div className="space-y-3 p-5 text-sm">
        {added !== null && (
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
            <Check size={14} /> {added === 0 ? "No websites to add." : `Added ${fmt(added)} website${added === 1 ? "" : "s"}.`}
          </p>
        )}
        {check && (
          <div className="space-y-2">
            <p>
              {check.found > 0
                ? <><span className="font-semibold">{fmt(check.found)}</span> lead{check.found === 1 ? "" : "s"} can get a website. {fmt(check.stillMissing)} still won&apos;t have one (no usable email or link to match).</>
                : <>Nothing to add. {fmt(check.stillMissing)} lead{check.stillMissing === 1 ? " has" : "s have"} no website and nothing in the data to match one to.</>}
            </p>
            {check.sample.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {check.sample.map((w, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate font-medium">{w.business_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{w.website.replace(/^https?:\/\//, "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 font-semibold text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => run(true)} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/40 disabled:opacity-50">
            {busy === "check" && <Loader2 size={14} className="animate-spin" />} Check what can be found
          </button>
          {check && check.found > 0 && (
            <button type="button" onClick={() => run(false)} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50">
              {busy === "apply" && <Loader2 size={14} className="animate-spin" />} Add {fmt(check.found)} website{check.found === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Delete leads in bulk ────────────────────────────────────────────────── */
function DeleteCard() {
  const [scope, setScope] = useState<PurgeScope | null>(null);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ deleted: number; kept: number } | null>(null);

  async function choose(next: PurgeScope) {
    setScope(next);
    setPreview(null);
    setTyped("");
    setError("");
    setResult(null);
    setLoading(true);
    const r = await post<PurgePreview>("/api/call-leads/purge", { scope: next, dryRun: true });
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.data);
  }

  async function remove() {
    if (!scope) return;
    setDeleting(true);
    setError("");
    const r = await post<{ deleted: number; kept: number }>("/api/call-leads/purge", { scope, dryRun: false });
    setDeleting(false);
    if (!r.ok) { setError(r.error); return; }
    setResult(r.data);
    setScope(null);
    setPreview(null);
    setTyped("");
  }

  const ready = !!preview && preview.count > 0 && typed.trim().toLowerCase() === "delete" && !deleting;

  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Trash2 size={14} /> Delete leads</h3>
        <p className="text-xs text-muted-foreground">
          To remove one lead, open it in the call list and use &ldquo;Delete this lead&rdquo;. To clear many at once, choose below.
        </p>
      </div>
      <div className="space-y-3 p-5 text-sm">
        {result && (
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
            <Check size={14} /> Deleted {fmt(result.deleted)} lead{result.deleted === 1 ? "" : "s"}.
            {result.kept > 0 && <span className="font-normal text-muted-foreground"> {fmt(result.kept)} kept because they have saved notes.</span>}
          </p>
        )}

        <div role="radiogroup" aria-label="Which leads to delete" className="space-y-2">
          {SCOPES.map((o) => (
            <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", scope === o.id ? "border-destructive/50 bg-destructive/5" : "hover:bg-muted/40")}>
              <input type="radio" name="purge-scope" checked={scope === o.id} onChange={() => { void choose(o.id); }} className="mt-1 accent-[var(--destructive)]" />
              <span>
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.blurb}</span>
              </span>
            </label>
          ))}
        </div>

        {loading && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Counting…</p>}

        {preview && scope && (
          <div className="space-y-3 rounded-lg bg-muted/40 p-4">
            {preview.count === 0 ? (
              <p className="font-semibold">Nothing matches, so there&apos;s nothing to delete.
                {preview.kept > 0 && <span className="font-normal text-muted-foreground"> {fmt(preview.kept)} were kept because they have saved notes.</span>}
              </p>
            ) : (
              <>
                <p>
                  <span className="font-bold text-destructive">{fmt(preview.count)} lead{preview.count === 1 ? "" : "s"}</span> will be deleted.
                  {scope === "untouched"
                    ? (preview.kept > 0 ? <> {fmt(preview.kept)} are kept because they have saved notes.</> : null)
                    : <> {fmt(preview.called)} {preview.called === 1 ? "has" : "have"} been called, so their notes and history are deleted too.</>}
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  <li>This can&apos;t be undone.</li>
                  <li>Booked sales calls stay in the calendar and pipeline.</li>
                  <li>If you import the sheet again, deleted leads come back as new{scope === "all" ? ", including any do-not-call numbers" : ""}.</li>
                </ul>
                <div>
                  <label htmlFor="purge-confirm" className="mb-1 block text-xs font-semibold text-foreground/80">Type <span className="font-mono">delete</span> to confirm</label>
                  <input
                    id="purge-confirm"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    className="w-full max-w-[220px] rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={remove}
                  disabled={!ready}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-destructive/90 active:scale-[0.97] disabled:opacity-40"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete {fmt(preview.count)} lead{preview.count === 1 ? "" : "s"}
                </button>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 font-semibold text-destructive">{error}</p>}
      </div>
    </section>
  );
}
