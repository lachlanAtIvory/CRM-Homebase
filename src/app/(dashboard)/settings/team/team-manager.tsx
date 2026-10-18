"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PRESET, PRESETS, SECTION_GROUPS, SECTIONS, sectionLabel, type SectionKey,
} from "@/lib/hq/access";
import type { AuditEntry, TeamMember, TeamOverview } from "@/lib/hq/team-admin";
import { formatSydney } from "@/lib/hq/sydney-time";
import {
  AlertTriangle, Check, ChevronDown, Copy, Eye, Loader2, Lock, ShieldCheck, Trash2, UserPlus,
} from "lucide-react";

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium transition-all hover:bg-muted/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

type Toast = { text: string; tone: "ok" | "error" };

async function call<T>(url: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "That didn't work. Try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

const sameSet = (a: SectionKey[], b: SectionKey[]) => a.length === b.length && a.every((x) => b.includes(x));

/* ────────────────────────────────────────────────────────────────────────────
   The screen
──────────────────────────────────────────────────────────────────────────── */
export function TeamManager({ initial }: { initial: TeamOverview }) {
  const [team, setTeam] = useState<TeamOverview>(initial);
  const [toast, setToast] = useState<Toast | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function say(text: string, tone: Toast["tone"] = "ok") {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 7000 : 3500);
  }

  return (
    <div className="space-y-5">
      <LockBanner team={team} />
      <Founders team={team} />
      <Members
        team={team}
        justAdded={justAdded}
        onTeam={setTeam}
        say={say}
      />
      <AddPerson
        onAdded={(overview, member) => { setTeam(overview); setJustAdded(member.id); say(`${member.name ?? member.email} added.`); }}
        say={say}
      />
      <ChangeLog entries={team.audit} />

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

/* ── Status of the two setup steps ───────────────────────────────────────── */
function LockBanner({ team }: { team: TeamOverview }) {
  const registered = team.founders.filter((f) => f.last_login_at).length;

  if (team.setupNeeded) {
    return (
      <Banner tone="warn" icon={<AlertTriangle size={16} />} title="One setup step first">
        <p>
          The team tables don&apos;t exist yet. In the Supabase SQL editor, paste in and run{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">supabase/migrations/20261018120000_add_team_access.sql</code>, then reload this page.
          It only adds things; nothing existing changes.
        </p>
      </Banner>
    );
  }
  if (team.hardened === true) {
    return (
      <Banner tone="good" icon={<ShieldCheck size={16} />} title="The database is locked to these settings">
        <p>Hidden sections are blocked in the database too, not just removed from the menu, so they can&apos;t be reached any other way.</p>
      </Banner>
    );
  }
  return (
    <Banner tone="warn" icon={<Lock size={16} />} title="Step 2 before you give anyone access: lock the database">
      <p>
        Right now a hidden section is only hidden in the app. Someone technical could still read the data directly. Do this once, before
        anyone but you two signs in:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Both of you open the CRM once (this registers you as managers).{" "}
          <span className={cn("font-semibold", registered === team.founders.length ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300")}>
            {registered} of {team.founders.length} registered{team.founders.map((f) => (f.last_login_at ? ` · ${f.name} ✓` : ` · ${f.name} not yet`)).join("")}.
          </span>
        </li>
        <li>
          In the Supabase SQL editor, run{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">supabase/migrations/20261018130000_lock_database_to_team_access.sql</code>. It refuses to run
          until both of you are registered, so you can&apos;t lock yourselves out.
        </li>
        <li>Reload this page. This banner turns green.</li>
      </ol>
      <p className="mt-2 text-xs opacity-80">
        If anything ever goes wrong, <code className="rounded bg-muted px-1 py-0.5">supabase/rollbacks/20261018130000_unlock_database.sql</code> puts everything back.
      </p>
    </Banner>
  );
}

function Banner({ tone, icon, title, children }: { tone: "good" | "warn"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 text-sm",
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <div className="mb-1 flex items-center gap-2 font-semibold">{icon} {title}</div>
      <div className="space-y-1 text-[13px] leading-relaxed">{children}</div>
    </div>
  );
}

/* ── Ryan and Lachlan ────────────────────────────────────────────────────── */
function Founders({ team }: { team: TeamOverview }) {
  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold">Managers</h2>
        <p className="text-xs text-muted-foreground">Full access to everything, including this screen. They can&apos;t be changed here.</p>
      </div>
      <ul className="divide-y">
        {team.founders.map((f) => (
          <li key={f.email} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={f.name} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{f.name}</div>
              <div className="truncate text-xs text-muted-foreground">{f.email}</div>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">Manager</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/* ── The team members ────────────────────────────────────────────────────── */
function Members({ team, justAdded, onTeam, say }: {
  team: TeamOverview;
  justAdded: string | null;
  onTeam: (t: TeamOverview) => void;
  say: (text: string, tone?: Toast["tone"]) => void;
}) {
  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold">Team members</h2>
        <p className="text-xs text-muted-foreground">Each person only sees the sections you switch on for them.</p>
      </div>
      {team.members.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No one yet. Add the cold caller below: put their email in now and they can sign in the moment they have it.
        </p>
      ) : (
        <ul className="divide-y">
          {team.members.map((m) => (
            <MemberRow key={m.id} member={m} startOpen={m.id === justAdded} onTeam={onTeam} say={say} />
          ))}
        </ul>
      )}
    </section>
  );
}

function statusInfo(m: TeamMember): { label: string; cls: string; detail: string } {
  if (m.status === "deactivated") return { label: "Switched off", cls: "bg-destructive/10 text-destructive", detail: "Can't sign in or see anything." };
  if (m.status === "invited") return { label: "Waiting for first sign-in", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300", detail: "Hasn't signed in yet." };
  return {
    label: "Active",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    detail: m.last_login_at ? `Last signed in ${formatSydney(m.last_login_at)}` : "Signed in.",
  };
}

function MemberRow({ member, startOpen, onTeam, say }: {
  member: TeamMember;
  startOpen: boolean;
  onTeam: (t: TeamOverview) => void;
  say: (text: string, tone?: Toast["tone"]) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState<SectionKey[]>(member.sections);
  const [busy, setBusy] = useState<"save" | "status" | "remove" | "preview" | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep the editor in step when the saved access changes underneath it.
  useEffect(() => { setDraft(member.sections); }, [member.sections]);

  const dirty = !sameSet(draft, member.sections);
  const info = statusInfo(member);
  const display = member.name?.trim() || member.email;
  const off = member.status === "deactivated";
  const signInUrl = typeof window !== "undefined" ? window.location.origin : "";

  function toggle(key: SectionKey) {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

  async function save() {
    setBusy("save");
    const r = await call<{ member: TeamMember; team: TeamOverview }>(`/api/team/${member.id}`, "PATCH", { sections: draft });
    setBusy(null);
    if (!r.ok) { say(r.error, "error"); return; }
    onTeam(r.data.team);
    say(`${display}'s access updated. It applies straight away.`);
  }

  async function setStatus(status: "active" | "deactivated") {
    if (status === "deactivated" && !window.confirm(`Switch off ${display}? They'll be signed out on their next click and can't get back in until you switch them on again.`)) return;
    setBusy("status");
    const r = await call<{ team: TeamOverview }>(`/api/team/${member.id}`, "PATCH", { status });
    setBusy(null);
    if (!r.ok) { say(r.error, "error"); return; }
    onTeam(r.data.team);
    say(status === "deactivated" ? `${display} is switched off.` : `${display} is switched back on.`);
  }

  async function remove() {
    if (!window.confirm(`Remove ${display} from the team completely? Their email will no longer be able to sign in. Anything they logged (notes, calls) stays.`)) return;
    setBusy("remove");
    const r = await call<{ team: TeamOverview }>(`/api/team/${member.id}`, "DELETE");
    setBusy(null);
    if (!r.ok) { say(r.error, "error"); return; }
    onTeam(r.data.team);
    say(`${display} removed.`);
  }

  async function preview() {
    if (dirty && !window.confirm("You have unsaved changes. The preview shows what's saved, not these changes. Preview anyway?")) return;
    setBusy("preview");
    const r = await call<{ landing: string }>("/api/preview", "POST", { id: member.id });
    if (!r.ok) { setBusy(null); say(r.error, "error"); return; }
    window.location.href = r.data.landing;
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(signInUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { say("Couldn't copy. Select the address and copy it by hand.", "error"); }
  }

  return (
    <li className={cn(off && "bg-muted/30")}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <Avatar name={display} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("truncate text-sm font-semibold", off && "text-muted-foreground line-through")}>{display}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", info.cls)}>{info.label}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{member.email} · {info.detail}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {member.sections.length === 0 ? (
              <span className="text-xs italic text-muted-foreground">Can&apos;t see anything yet</span>
            ) : (
              member.sections.map((s) => (
                <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/80">{sectionLabel(s)}</span>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!off && (
            <button
              type="button"
              onClick={preview}
              disabled={busy !== null}
              title={`See the CRM exactly as ${display} sees it`}
              className={btnCls}
            >
              {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview as {member.name?.trim() || "them"}
            </button>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={btnCls}>
            {open ? "Close" : "Edit access"} <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t bg-muted/20 px-5 py-4 animate-in fade-in slide-in-from-top-1">
          {member.status === "invited" && (
            <div className="rounded-lg border bg-card p-3 text-sm">
              <p className="font-semibold">How {display} gets in</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Nothing more to set up. Tell them to open the address below and choose <b>Sign in with Google</b> using{" "}
                <b>{member.email}</b>. They&apos;ll go straight to their own screen.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{signInUrl}</code>
                <button type="button" onClick={copyLink} className={btnCls}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground/80">Start from</span>
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.blurb}
                  onClick={() => setDraft(p.sections)}
                  className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:border-primary hover:text-primary", sameSet(draft, p.sections) ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <SectionSwitches value={draft} onToggle={toggle} disabled={busy !== null} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-40"
            >
              {busy === "save" && <Loader2 size={14} className="animate-spin" />} Save access
            </button>
            {dirty && (
              <>
                <button type="button" onClick={() => setDraft(member.sections)} disabled={busy !== null} className={btnCls}>Discard changes</button>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Unsaved changes</span>
              </>
            )}
            <span className="ml-auto flex items-center gap-2">
              {off ? (
                <button type="button" onClick={() => setStatus("active")} disabled={busy !== null} className={btnCls}>
                  {busy === "status" && <Loader2 size={13} className="animate-spin" />} Switch back on
                </button>
              ) : (
                <button type="button" onClick={() => setStatus("deactivated")} disabled={busy !== null} className={cn(btnCls, "hover:border-destructive hover:text-destructive")}>
                  {busy === "status" && <Loader2 size={13} className="animate-spin" />} Switch off
                </button>
              )}
              <button type="button" onClick={remove} disabled={busy !== null} className={cn(btnCls, "hover:border-destructive hover:text-destructive")}>
                <Trash2 size={13} /> Remove
              </button>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── The toggles ─────────────────────────────────────────────────────────── */
function SectionSwitches({ value, onToggle, disabled }: {
  value: SectionKey[]; onToggle: (k: SectionKey) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {SECTION_GROUPS.map((group) => (
        <div key={group}>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</div>
          <ul className="divide-y rounded-lg border bg-card">
            {SECTIONS.filter((s) => s.group === group).map((s) => {
              const on = value.includes(s.key);
              return (
                <li key={s.key} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {s.label}
                      {s.sensitive && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">Sensitive</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  </div>
                  <Switch on={on} label={s.label} disabled={disabled} onClick={() => onToggle(s.key)} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Switch({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/* ── Add someone ─────────────────────────────────────────────────────────── */
function AddPerson({ onAdded, say }: {
  onAdded: (overview: TeamOverview, member: TeamMember) => void;
  say: (text: string, tone?: Toast["tone"]) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = useMemo(() => PRESETS.find((p) => p.key === preset)!, [preset]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await call<{ member: TeamMember; team: TeamOverview }>("/api/team", "POST", { name, email, preset });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setName(""); setEmail("");
    onAdded(r.data.team, r.data.member);
  }

  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={14} /> Add someone</h2>
        <p className="text-xs text-muted-foreground">
          Add them as soon as you have their email, even before they&apos;ve ever signed in. When they sign in with Google using that address, they&apos;re
          in and see only what you choose.
        </p>
      </div>
      <form onSubmit={add} className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jan" autoComplete="off" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Email they&apos;ll sign in with <span className="text-destructive">*</span></span>
            <input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jan@agentivory.com" autoComplete="off" />
          </label>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-foreground/80">Start with</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors", preset === p.key ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:border-primary hover:text-primary")}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{chosen.blurb} You can change any of this afterwards.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add to the team
        </button>
      </form>
    </section>
  );
}

/* ── Change log ──────────────────────────────────────────────────────────── */
function describe(e: AuditEntry): string {
  const who = e.target_email ?? "";
  const added = (e.detail.added as string[] | undefined) ?? [];
  const removed = (e.detail.removed as string[] | undefined) ?? [];
  switch (e.action) {
    case "added member": return `added ${who}`;
    case "changed access": {
      const parts = [
        added.length ? `turned on ${added.map(sectionLabel).join(", ")}` : null,
        removed.length ? `turned off ${removed.map(sectionLabel).join(", ")}` : null,
      ].filter(Boolean);
      return `${parts.join(" and ") || "changed access"} for ${who}`;
    }
    case "deactivated": return `switched off ${who}`;
    case "reactivated": return `switched ${who} back on`;
    case "removed member": return `removed ${who}`;
    default: return `${e.action} ${who}`.trim();
  }
}

function ChangeLog({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="rounded-xl border bg-card ring-1 ring-foreground/5">
      <div className="border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold">Recent changes</h2>
        <p className="text-xs text-muted-foreground">Who changed whose access, and when.</p>
      </div>
      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{e.actor.split("@")[0]}</span> {describe(e)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatSydney(e.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
