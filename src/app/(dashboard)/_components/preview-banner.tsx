"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";

/**
 * Shown across the top of every page while a manager is previewing as a team
 * member, so it's never unclear whose view this is.
 */
export function PreviewBanner({ name, email }: { name: string | null; email: string }) {
  const [busy, setBusy] = useState(false);
  const who = name?.trim() || email;

  async function exit() {
    setBusy(true);
    try { await fetch("/api/preview", { method: "DELETE" }); } catch { /* fall through and reload anyway */ }
    window.location.href = "/settings/team";
  }

  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950">
      <span className="flex items-center gap-2">
        <Eye size={15} />
        Previewing as {who}. This is exactly what they see.
        <span className="hidden font-normal opacity-80 sm:inline">Anything you do here is real, done as you.</span>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950 px-3 py-1 text-xs font-bold text-amber-50 transition-all hover:bg-amber-900 active:scale-[0.97] disabled:opacity-60"
      >
        {busy && <Loader2 size={12} className="animate-spin" />} Exit preview
      </button>
    </div>
  );
}
