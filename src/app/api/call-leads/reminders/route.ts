import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccessApi } from "@/lib/hq/access-guard";
import { fetchMyReminders } from "@/lib/hq/callback-reminders";

/**
 * Call list — my callbacks that are due, overdue, or due in the next few
 * minutes. Polled by the reminder component in the layout.
 */
export const runtime = "nodejs";

export async function GET() {
  const check = await requireAccessApi("call-list");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const supabase = await createClient();
  const reminders = await fetchMyReminders(supabase, {
    email: check.access.email,
    isManager: check.access.role === "manager",
  });
  return NextResponse.json({ reminders, now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
