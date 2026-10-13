/**
 * Call list — shared types, status rules and queries.
 *
 * Status groups drive the three tabs the caller works from:
 *   To call    new / no answer / voicemail  (worked least-tried first)
 *   Callbacks  a callback was promised, soonest first
 *   Done       booked / not interested / wrong number / do not call
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSydney } from "./sydney-time";

export type LeadStatus =
  | "new" | "no_answer" | "voicemail" | "callback"
  | "not_interested" | "wrong_number" | "do_not_call" | "booked";

export type Outcome =
  | "note" | "no_answer" | "voicemail" | "not_interested"
  | "wrong_number" | "do_not_call" | "callback" | "booked";

export type Tab = "todo" | "callbacks" | "done";

export const TAB_STATUSES: Record<Tab, LeadStatus[]> = {
  todo:      ["new", "no_answer", "voicemail"],
  callbacks: ["callback"],
  done:      ["booked", "not_interested", "wrong_number", "do_not_call"],
};

export const TAB_LABEL: Record<Tab, string> = { todo: "To call", callbacks: "Callbacks", done: "Done" };

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  no_answer: "No answer",
  voicemail: "Voicemail",
  callback: "Callback",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  do_not_call: "Do not call",
  booked: "Sales call booked",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  note: "Note",
  no_answer: "No answer",
  voicemail: "Voicemail",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  do_not_call: "Do not call",
  callback: "Callback set",
  booked: "Sales call booked",
};

export function tabOfStatus(s: LeadStatus): Tab {
  return TAB_STATUSES.callbacks.includes(s) ? "callbacks" : TAB_STATUSES.done.includes(s) ? "done" : "todo";
}

/** Who a booked sales call is with. */
export type SalesCallWith = "ryan" | "lachlan" | "either";
export const SALES_CALL_WITH: SalesCallWith[] = ["ryan", "lachlan", "either"];

export type CallLead = {
  id: string;
  business_name: string;
  phone: string | null;
  phone_e164: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  google_maps_url: string | null;
  extra: Record<string, string>;
  status: LeadStatus;
  attempts: number;
  last_called_at: string | null;
  callback_at: string | null;
  client_id: string | null;
  imported_at: string;
};

export type CallLeadNote = {
  id: string;
  lead_id: string;
  outcome: Outcome;
  body: string | null;
  actor: string;
  created_by: string | null;
  occurred_at: string;
};

/** Tab sizes, plus how many promised callbacks are due right now. */
export type TabCounts = Record<Tab, number> & { due: number };

export const PAGE_SIZE = 300;

/** Strip characters that have meaning inside a PostgREST filter string. */
function safeSearch(q: string): string {
  return q.replace(/[,()%*\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type LeadQuery = { tab: Tab; q?: string };

/**
 * One page of leads for a tab, or for a search across all tabs.
 * Search matches the business name and, when the text has 4+ digits, the number.
 */
export async function fetchCallLeads(
  supabase: SupabaseClient,
  { tab, q }: LeadQuery,
): Promise<{ leads: CallLead[]; total: number; error: { code?: string; message: string } | null }> {
  const search = safeSearch(q ?? "");
  let query = supabase.from("call_leads").select("*", { count: "exact" });

  if (search) {
    const digits = search.replace(/\D/g, "").replace(/^0/, "");
    const clauses = [`business_name.ilike.%${search}%`];
    if (digits.length >= 4) clauses.push(`phone_e164.ilike.%${digits}%`, `phone.ilike.%${digits}%`);
    query = query.or(clauses.join(",")).order("business_name", { ascending: true });
  } else {
    query = query.in("status", TAB_STATUSES[tab]);
    if (tab === "todo") {
      query = query.order("attempts", { ascending: true }).order("imported_at", { ascending: true }).order("id");
    } else if (tab === "callbacks") {
      query = query.order("callback_at", { ascending: true });
    } else {
      query = query.order("last_called_at", { ascending: false, nullsFirst: false });
    }
  }

  const { data, count, error } = await query.limit(PAGE_SIZE);
  if (error) return { leads: [], total: 0, error: { code: error.code, message: error.message } };
  return { leads: (data ?? []) as CallLead[], total: count ?? 0, error: null };
}

export async function fetchTabCounts(supabase: SupabaseClient): Promise<TabCounts> {
  const one = async (tab: Tab) => {
    const { count } = await supabase
      .from("call_leads")
      .select("id", { count: "exact", head: true })
      .in("status", TAB_STATUSES[tab]);
    return count ?? 0;
  };
  const due = async () => {
    const { count } = await supabase
      .from("call_leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "callback")
      .lte("callback_at", new Date().toISOString());
    return count ?? 0;
  };
  const [todo, callbacks, done, dueNow] = await Promise.all([one("todo"), one("callbacks"), one("done"), due()]);
  return { todo, callbacks, done, due: dueNow };
}

/** True when the migration hasn't been run yet (table missing). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** One timeline entry as a line of plain text: "- Tue, 20 Oct, 2:14 pm · No answer: rang out twice". */
export function formatNoteLine(n: { outcome: Outcome; body: string | null; occurred_at: string }): string {
  const text = (n.body ?? "").replace(/\s*\n\s*/g, " ").trim();
  return `- ${formatSydney(n.occurred_at)} · ${OUTCOME_LABEL[n.outcome]}${text ? `: ${text}` : ""}`;
}
