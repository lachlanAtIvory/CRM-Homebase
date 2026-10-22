"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatSydney } from "@/lib/hq/sydney-time";
import { Check, Circle, Copy } from "lucide-react";
import type { DialSheetStatus } from "@/lib/hq/dialsheet-events";

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

export function DialSheetStatusView({ status, webhookUrl }: { status: DialSheetStatus; webhookUrl: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  const steps: { done: boolean; title: string; body: string }[] = [
    {
      done: !status.setupNeeded,
      title: "Database is ready",
      body: status.setupNeeded
        ? "Run the DialSheet migration (20261023120000_add_dialsheet.sql) in the Supabase SQL editor."
        : "The call log tables exist.",
    },
    {
      done: status.secretConfigured,
      title: "Signing secret is set",
      body: status.secretConfigured
        ? "DIALSHEET_WEBHOOK_SECRET is set, so incoming calls can be checked as genuinely from DialSheet."
        : "Copy the webhook's signing secret (it starts with whsec_) from DialSheet into Vercel as DIALSHEET_WEBHOOK_SECRET, then redeploy.",
    },
    {
      done: !!status.lastEventAt,
      title: "DialSheet is sending calls",
      body: status.lastEventAt
        ? `Last message from DialSheet: ${formatSydney(status.lastEventAt)}.`
        : "Nothing received yet. Add the webhook below, then press Send test on it in DialSheet.",
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
          In DialSheet go to <b>Settings &rsaquo; Webhooks</b> and add this address. Webhooks are on DialSheet&apos;s <b>Pro plan</b>.
          Add it from <b>Jan&apos;s own DialSheet account</b>: a webhook only sends the calls of the person who added it.
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
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>If more than one person has a webhook, put each one&apos;s signing secret in <code>DIALSHEET_WEBHOOK_SECRET</code>, separated by commas.</li>
          <li>Calls show up on the lead a couple of minutes after they end. Answered calls can take up to 20 minutes, because DialSheet waits for its AI summary.</li>
          <li>A call is matched to a lead by phone number, so Jan&apos;s DialSheet leads need the same numbers as the Call List. Calls to 1300/1800 numbers can&apos;t be matched and are kept as unmatched.</li>
          <li>Logging an outcome in DialSheet doesn&apos;t change the lead here. Jan still presses the result button on the Call List, which is what the scoreboard counts.</li>
        </ul>
      </section>

      <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold">Recording and consent</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          DialSheet records calls by default (Settings &rsaquo; Privacy &rsaquo; <b>Record calls</b>) and its docs don&apos;t mention announcing that to the person called.
          In Australia, recording a call generally needs everyone on it to know. Either switch recording off, or have Jan&apos;s script say the call is recorded.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <span className="text-xs text-muted-foreground">{status.calls24h} call{status.calls24h === 1 ? "" : "s"} logged in the last 24 hours</span>
        </div>
        {status.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Once DialSheet is connected, every message it sends shows up here.</p>
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
