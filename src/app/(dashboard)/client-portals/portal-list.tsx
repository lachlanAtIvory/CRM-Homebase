"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { regeneratePortalToken } from "./actions";
import { Check, Copy, ExternalLink, Loader2, RotateCcw } from "lucide-react";

type HqClient = {
  id:           string;
  name:         string;
  vertical:     string;
  status:       string;
  portal_token: string | null;
};

export function PortalList({ clients }: { clients: HqClient[] }) {
  return (
    <div className="space-y-3">
      {clients.map((c) => (
        <PortalRow key={c.id} client={c} />
      ))}
    </div>
  );
}

function PortalRow({ client }: { client: HqClient }) {
  const [token, setToken] = useState(client.portal_token);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = token ? `${origin}/client/${token}` : null;

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function regenerate() {
    if (!confirm(`Regenerate the portal link for ${client.name}? The old link will stop working immediately.`)) return;
    startTransition(async () => {
      const newToken = await regeneratePortalToken(client.id);
      setToken(newToken);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{client.name}</h3>
            {client.status !== "active" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Inactive
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">{client.vertical}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40"
            >
              Open <ExternalLink size={11} />
            </a>
          )}
          <button
            type="button"
            onClick={regenerate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
          >
            {pending ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            Regenerate
          </button>
        </div>
      </div>

      {link ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 truncate rounded-lg border bg-muted/30 px-3 py-1.5 font-mono text-[11px] text-muted-foreground outline-none"
          />
          <button
            type="button"
            onClick={copy}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              copied ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "bg-background hover:bg-muted/40",
            )}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No portal link yet — click Regenerate to create one.</p>
      )}
    </div>
  );
}
