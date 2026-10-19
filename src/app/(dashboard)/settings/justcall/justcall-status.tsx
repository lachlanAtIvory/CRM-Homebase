"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatSydney } from "@/lib/hq/sydney-time";
import { Check, Circle, Copy } from "lucide-react";
import type { JustCallStatus } from "@/lib/hq/justcall-events";

const OUTCOME_STYLE: Record<string, string> = {
  processed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  unmatched: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  ignored:   "bg-muted text-muted-foreground",
  rejected:  "bg-red-500/15 text-red-700 dark:text-red-300",
  error:     "bg-red-500/15 text-red-700 dark:text-red-300",
};

const OUTCOME_HELP: Record<string, string> = {
  processed: "Saved on a lead",
  unmatched: "Saved, no lead matched",
  ignored:   "Not used",
  rejected:  "Refused (bad signature)",
  error:     "Couldn't save",
};

export function JustCallStatusView({ status, webhookUrl }: { status: JustCallStatus; webhookUrl: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  const steps: { done: boolean; title: string; body: string }[] = [
    {
      done: !status.setupNeeded,
      title: "Database is ready",
      body: status.setupNeeded
        ? "Run the JustCall migration (20261020120000_add_justcall.sql) in the Supabase SQL editor."
        : "The call log tables exist.",
    },
    {
      done: status.secretConfigured,
      title: "API secret is set",
      body: status.secretConfigured
        ? "JUSTCALL_API_SECRET is set, so incoming calls can be checked as genuinely from JustCall."
        : "Add JUSTCALL_API_SECRET in Vercel (JustCall > APIs and Webhooks > API Keys), then redeploy.",
    },
    {
      done: status.dialerEnabled,
      title: "Call buttons are on",
      body: status.dialerEnabled
        ? "NEXT_PUBLIC_JUSTCALL_DIALER is on, so Jan sees a Call button on every lead."
        : "Add NEXT_PUBLIC_JUSTCALL_DIALER=true in Vercel and redeploy to show the Call button.",
    },
    {
      done: !!status.lastEventAt,
      title: "JustCall is sending calls",
      body: status.lastEventAt
        ? `Last message from JustCall: ${formatSydney(status.lastEventAt)}.`
        : "Nothing received yet. Add the webhook below in JustCall, then make a test call.",
    },
    {
      done: status.apiKeyConfigured,
      title: "Recordings play inside the CRM (optional)",
      body: status.apiKeyConfigured
        ? "JUSTCALL_API_KEY is set, so call recordings play on the lead."
        : "Add JUSTCALL_API_KEY in Vercel to play recordings on the lead. Without it, recordings open from JustCall's own link.",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="text-sm font-semibold">Setup checklist</h2>
        <ol className="mt-3 space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start gap-3">
              <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", s.done ? "bg-emerald-600 text-white" : "border-2 border-muted-foreground/30 text-muted-foreground/40")}>
                {s.done ? <Check size={12} /> : <Circle size={6} />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{s.title}</span>
                <span className="block text-xs text-muted-foreground">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <h2 className="text-sm font-semibold">Webhook address</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          In JustCall go to <b>APIs and Webhooks &rsaquo; Webhook Settings</b>, add a webhook with this address, and tick <b>Call completed</b> and <b>Call updated</b>{" "}
          (plus the Sales Dialer versions if you use that). Webhooks need JustCall&apos;s <b>Team plan or above</b>.
        </p>
        <button
          type="button"
          onClick={copy}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
        >
          <code className="min-w-0 break-all text-xs">{webhookUrl}</code>
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold", copied ? "text-emerald-600" : "text-primary")}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </span>
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          Jan needs to be signed in to JustCall in the same browser, with pop-ups allowed for this site. His JustCall agent email should match his CRM email so calls show his name.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <span className="text-xs text-muted-foreground">{status.calls24h} call{status.calls24h === 1 ? "" : "s"} logged in the last 24 hours</span>
        </div>
        {status.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Once JustCall is connected, every message it sends shows up here.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {status.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                <span className={cn("rounded-full px-2 py-0.5 font-bold", OUTCOME_STYLE[e.outcome] ?? "bg-muted")}>{OUTCOME_HELP[e.outcome] ?? e.outcome}</span>
                <span className="font-mono text-muted-foreground">{e.event_type ?? "(unknown)"}</span>
                <span className="text-muted-foreground">{formatSydney(e.received_at)}</span>
                {e.detail && <span className="w-full text-muted-foreground sm:w-auto">{e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
