import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Callback reminders.
 *
 * A callback is a promise to ring a clinic back at a set time. These helpers
 * decide WHEN to nudge the person who made it: shortly before, at the time,
 * and again every 15 minutes while it's overdue. Pure and testable; the
 * component in the layout does the actual toast / chime / notification.
 */

export type Reminder = { id: string; business_name: string; phone: string | null; callback_at: string };

export const SOON_MINUTES = 5;
export const OVERDUE_REPEAT_MINUTES = 15;
export const OVERDUE_MAX_REPEATS = 4;
/** Anything overdue by more than this is left to the banner; no more pop-ups. */
export const STALE_AFTER_MINUTES = 180;

export type ReminderAction = {
  /** Stored once fired so a page reload doesn't repeat it. */
  key: string;
  kind: "soon" | "due" | "overdue";
  lead: Reminder;
  /** Whole minutes: until it's due (soon) or since it was due (due / overdue). */
  minutes: number;
};

export function planReminders(
  reminders: Reminder[],
  nowMs: number,
  fired: { has(key: string): boolean },
): { actions: ReminderAction[]; dueCount: number } {
  const actions: ReminderAction[] = [];
  let dueCount = 0;

  for (const lead of reminders) {
    const at = new Date(lead.callback_at).getTime();
    if (Number.isNaN(at)) continue;
    const until = (at - nowMs) / 60000;                 // positive = still to come
    const base = `${lead.id}|${lead.callback_at}`;

    if (until > SOON_MINUTES) continue;

    if (until > 0) {
      const key = `${base}|soon`;
      if (!fired.has(key)) actions.push({ key, kind: "soon", lead, minutes: Math.max(1, Math.ceil(until)) });
      continue;
    }

    dueCount++;
    const late = -until;
    if (late > STALE_AFTER_MINUTES) continue;

    const dueKey = `${base}|due`;
    if (!fired.has(dueKey)) {
      actions.push({ key: dueKey, kind: "due", lead, minutes: Math.floor(late) });
      continue;
    }
    const n = Math.floor(late / OVERDUE_REPEAT_MINUTES);
    if (n >= 1 && n <= OVERDUE_MAX_REPEATS) {
      const key = `${base}|over${n}`;
      if (!fired.has(key)) actions.push({ key, kind: "overdue", lead, minutes: Math.floor(late) });
    }
  }
  return { actions, dueCount };
}

/** One line of text for a toast or notification. */
export function reminderText(a: ReminderAction): { title: string; body: string } {
  const who = a.lead.business_name;
  const phone = a.lead.phone ? ` · ${a.lead.phone}` : "";
  if (a.kind === "soon") return { title: `Callback in ${a.minutes} min`, body: `${who}${phone}` };
  if (a.kind === "due") return { title: "Callback due now", body: `${who}${phone}` };
  return { title: `Callback ${a.minutes} min overdue`, body: `${who}${phone}` };
}

/* ── Which callbacks are mine and close ──────────────────────────────────── */

const SAFE_EMAIL = /^[a-z0-9._+@-]+$/i;

/**
 * Callbacks that are due, overdue, or due within `withinMinutes`, for one person.
 * Each callback records who promised it (call_leads.callback_by), so a caller's
 * callbacks don't ping the founders. Callbacks with no recorded owner (made
 * before that existed) go to managers.
 */
export async function fetchMyReminders(
  supabase: SupabaseClient,
  { email, isManager }: { email: string; isManager: boolean },
  withinMinutes = SOON_MINUTES,
  now = new Date(),
): Promise<Reminder[]> {
  const until = new Date(now.getTime() + withinMinutes * 60000).toISOString();
  const me = email.trim().toLowerCase();

  let q = supabase
    .from("call_leads")
    .select("id, business_name, phone, callback_at")
    .eq("status", "callback")
    .lte("callback_at", until)
    .order("callback_at", { ascending: true })
    .limit(30);
  if (SAFE_EMAIL.test(me)) {
    q = q.or(isManager ? `callback_by.eq.${me},callback_by.is.null` : `callback_by.eq.${me}`);
  }
  let { data, error } = await q;

  if (error && /callback_by/.test(error.message)) {
    // The tasks/callback migration hasn't been run yet: no owner column, so everyone with the list sees them.
    ({ data, error } = await supabase
      .from("call_leads")
      .select("id, business_name, phone, callback_at")
      .eq("status", "callback")
      .lte("callback_at", until)
      .order("callback_at", { ascending: true })
      .limit(30));
  }
  if (error) return [];
  return (data ?? []) as Reminder[];
}
