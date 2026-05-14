"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import {
  deleteApplicationAction,
  deleteClientAction,
} from "./actions";

// ─── Per-application trash icon (inside the Applications list) ──────────────
export function DeleteApplicationButton({
  applicationId,
  clientId,
  label,
}: {
  applicationId: string;
  clientId:      string;
  label?:        string;
}) {
  const [pending, start] = useTransition();

  function handleClick(e: React.MouseEvent) {
    // The parent row is a Link — don't navigate when clicking the trash
    e.preventDefault();
    e.stopPropagation();

    const ok = window.confirm(
      `Delete this application${label ? ` (${label})` : ""}? This cannot be undone.`,
    );
    if (!ok) return;

    start(async () => {
      const result = await deleteApplicationAction(applicationId, clientId);
      if (result.ok) toast.success("Application deleted");
      else toast.error("Could not delete application", { description: result.error });
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      title="Delete application"
      aria-label="Delete application"
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  );
}

// ─── Danger Zone — delete whole client ──────────────────────────────────────
export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId:   string;
  clientName: string;
}) {
  const [pending, start] = useTransition();

  function handleClick() {
    const ok = window.confirm(
      `Delete ${clientName}?\n\nThis will permanently delete:\n  • All applications\n  • All deals\n  • All tasks\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    start(async () => {
      const result = await deleteClientAction(clientId);
      // On success we redirect server-side, so this line only runs on failure
      if (result?.ok === false) {
        toast.error("Could not delete client", { description: result.error });
      }
    });
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting this client removes their applications, deals, and tasks
            permanently. There is no undo.
          </p>
          <button
            type="button"
            onClick={handleClick}
            disabled={pending}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-destructive/90 hover:shadow active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {pending ? "Deleting…" : `Delete ${clientName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
