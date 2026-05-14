"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { deleteApplicationFromList } from "./actions";

/**
 * Trash button for the global Applications list. Calls a server action that
 * revalidates /applications so the row disappears without a full reload.
 */
export function DeleteApplicationListRowButton({
  applicationId,
  label,
}: {
  applicationId: string;
  label:         string;
}) {
  const [pending, start] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const ok = window.confirm(
      `Delete application for ${label}?\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    start(async () => {
      const result = await deleteApplicationFromList(applicationId);
      if (result.ok) toast.success("Application deleted");
      else toast.error("Could not delete application", { description: result.error });
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      title="Delete application"
      aria-label="Delete application"
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  );
}
