"use client";

import { useEffect, useRef, useState } from "react";
import { AGENTS, type AgentConfig, type AgentField } from "@/lib/hq/agents-config";
import { cn } from "@/lib/utils";
import {
  Bot, CheckCircle2, ExternalLink, Loader2, PhoneCall, XCircle,
} from "lucide-react";

type Client = { id: string; name: string };

type JobState = {
  id:      string;
  status:  "queued" | "running" | "done" | "failed";
  result?: Record<string, unknown> | null;
  error?:  string;
};

const POLL_MS      = 2500;
const POLL_MAX_MIN = 10; // stop polling after 10 min; n8n jobs shouldn't run longer

export function MissionControl({
  clients, latestCallByClient,
}: {
  clients:            Client[];
  latestCallByClient: Record<string, string>;
}) {
  // One active job per agent card; history stays in the jobs table.
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Clear all polling timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearInterval);
  }, []);

  function pollJob(agentId: string, jobId: string) {
    const startedAt = Date.now();
    clearInterval(timersRef.current[agentId]);
    timersRef.current[agentId] = setInterval(async () => {
      if (Date.now() - startedAt > POLL_MAX_MIN * 60_000) {
        clearInterval(timersRef.current[agentId]);
        setJobs((j) => ({
          ...j,
          [agentId]: { ...j[agentId], status: "failed", error: "Timed out waiting for n8n — check the workflow execution log." },
        }));
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return; // transient — keep polling
        const job = (await res.json()) as JobState;
        if (job.status === "done" || job.status === "failed") {
          clearInterval(timersRef.current[agentId]);
          setJobs((j) => ({
            ...j,
            [agentId]: {
              id:     jobId,
              status: job.status,
              result: job.result,
              error:  job.status === "failed"
                ? String((job.result as Record<string, unknown> | null)?.error ?? "Agent reported failure")
                : undefined,
            },
          }));
        }
      } catch { /* transient — keep polling */ }
    }, POLL_MS);
  }

  async function run(agent: AgentConfig, data: Record<string, string>) {
    setJobs((j) => ({ ...j, [agent.id]: { id: "", status: "queued" } }));
    try {
      const res = await fetch("/api/agents/run", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ agent: agent.id, data }),
      });
      const out = (await res.json()) as {
        id?: string; status?: string; error?: string; result?: Record<string, unknown>;
      };
      if (!res.ok || !out.id) {
        setJobs((j) => ({ ...j, [agent.id]: { id: "", status: "failed", error: out.error ?? `Request failed (${res.status})` } }));
        return;
      }
      if (out.status === "failed") {
        setJobs((j) => ({ ...j, [agent.id]: { id: out.id!, status: "failed", error: out.error } }));
        return;
      }
      if (out.status === "done") {
        // fire-and-forget agent — confirmed sent, nothing to poll
        setJobs((j) => ({ ...j, [agent.id]: { id: out.id!, status: "done", result: out.result } }));
        return;
      }
      setJobs((j) => ({ ...j, [agent.id]: { id: out.id!, status: "running" } }));
      pollJob(agent.id, out.id);
    } catch {
      setJobs((j) => ({ ...j, [agent.id]: { id: "", status: "failed", error: "Network error — try again." } }));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each card fires an n8n workflow. Results land back here when the run
        finishes — you can leave the page and check the jobs table later.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {AGENTS.map((agent) =>
          agent.kind === "status" ? (
            <StatusCard
              key={agent.id}
              agent={agent}
              clients={clients}
              latestCallByClient={latestCallByClient}
              job={jobs[agent.id]}
              onRun={() => run(agent, {})}
            />
          ) : (
            <FormCard
              key={agent.id}
              agent={agent}
              clients={clients}
              job={jobs[agent.id]}
              onRun={(data) => run(agent, data)}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ─── Form card ───────────────────────────────────────────────────────────────
function FormCard({
  agent, clients, job, onRun,
}: {
  agent:   AgentConfig;
  clients: Client[];
  job?:    JobState;
  onRun:   (data: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const busy = job?.status === "queued" || job?.status === "running";

  return (
    <div className="flex flex-col rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <CardHeader agent={agent} />

      <form
        className="mt-4 flex flex-1 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onRun(values);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {agent.fields.map((f) => (
            <div key={f.key} className={f.half ? "col-span-1" : "col-span-2"}>
              <Field
                field={f}
                clients={clients}
                value={values[f.key] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              />
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-2 pt-2">
          <JobStatus job={job} />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Working…</span>
              : (agent.submitLabel ?? "Run")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Status card (Call Monitor) ──────────────────────────────────────────────
function StatusCard({
  agent, clients, latestCallByClient, job, onRun,
}: {
  agent:              AgentConfig;
  clients:            Client[];
  latestCallByClient: Record<string, string>;
  job?:               JobState;
  onRun:              () => void;
}) {
  const busy = job?.status === "queued" || job?.status === "running";

  return (
    <div className="flex flex-col rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <CardHeader agent={agent} icon={<PhoneCall size={16} />} />

      <div className="mt-4 flex-1 space-y-1.5">
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clients in hq_clients yet.</p>
        ) : (
          clients.map((c) => {
            const last = latestCallByClient[c.id];
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{c.name}</span>
                <span className={cn(
                  "shrink-0 text-xs tabular-nums",
                  last ? "text-muted-foreground" : "font-medium text-amber-600",
                )}>
                  {last ? `last call ${formatWhen(last)}` : "no calls yet"}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 space-y-2">
        <JobStatus job={job} />
        <button
          type="button"
          disabled={busy}
          onClick={onRun}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          {busy
            ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking…</span>
            : (agent.submitLabel ?? "Run check")}
        </button>
      </div>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────
function CardHeader({ agent, icon }: { agent: AgentConfig; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon ?? <Bot size={16} />}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{agent.name}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{agent.description}</p>
      </div>
    </div>
  );
}

function Field({
  field, clients, value, onChange,
}: {
  field:    AgentField;
  clients:  Client[];
  value:    string;
  onChange: (v: string) => void;
}) {
  const base = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {field.label}{field.required && <span className="text-destructive"> *</span>}
      </span>
      {field.type === "textarea" ? (
        <textarea
          className={cn(base, "min-h-20 resize-y")}
          placeholder={field.placeholder}
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <select
          className={base}
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {field.optionsFrom === "hq_clients"
            ? clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
            : (field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          step={field.type === "number" ? "any" : undefined}
          className={base}
          placeholder={field.placeholder}
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function JobStatus({ job }: { job?: JobState }) {
  if (!job) return null;

  if (job.status === "queued" || job.status === "running") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        {job.status === "queued" ? "Queuing job…" : "n8n is working on it…"}
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <XCircle size={13} className="mt-0.5 shrink-0" />
        <span>{job.error ?? "Failed"}</span>
      </div>
    );
  }

  // done
  const link    = typeof job.result?.link    === "string" ? job.result.link    : null;
  const message = typeof job.result?.message === "string" ? job.result.message : null;
  return (
    <div className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 font-medium text-emerald-600">
        <CheckCircle2 size={13} /> Done
      </div>
      {message && <p className="text-foreground">{message}</p>}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Open result <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
