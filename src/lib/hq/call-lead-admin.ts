import type { SupabaseClient } from "@supabase/supabase-js";
import { guessWebsite, isMissingWebsite, WEBSITE_FROM_KEY } from "./website-guess";
import { fetchTabCounts, type TabCounts } from "./call-leads";

/**
 * Call list — housekeeping: delete leads, and fill in missing websites on
 * leads that are already in the list.
 *
 * Deleting a lead also deletes its notes and call history (they cascade).
 * It never touches the client, deal or calendar event a booking created.
 *
 * TODO(roles): manager-only once roles ship.
 */

type Failure = { error: string; status: number };
const isFailure = (x: unknown): x is Failure => !!x && typeof x === "object" && "error" in x;

const PAGE = 1000;
const MAX_PAGES = 30;
const DELETE_CHUNK = 100;
const DELETE_PARALLEL = 4;

/* ── Delete one lead ─────────────────────────────────────────────────────── */

export async function deleteLead(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: true; counts: TabCounts } | Failure> {
  const { data, error } = await supabase.from("call_leads").delete().eq("id", id).select("id");
  if (error) return { error: error.message, status: 500 };
  if (!data?.length) return { error: "That lead was already deleted.", status: 404 };
  return { ok: true, counts: await fetchTabCounts(supabase) };
}

/* ── Delete a batch of leads ─────────────────────────────────────────────── */

/**
 * What to delete:
 *   untouched  leads nobody has called and nobody has written a note on
 *   finished   booked, not interested and wrong-number leads (do-not-call numbers stay,
 *              so they can't come back as "new" if the sheet is imported again)
 *   all        everything, do-not-call included
 */
export type PurgeScope = "untouched" | "finished" | "all";
export const PURGE_SCOPES: PurgeScope[] = ["untouched", "finished", "all"];

const FINISHED_STATUSES = ["booked", "not_interested", "wrong_number"];

export type PurgeSummary = {
  /** Leads that will be (or were) deleted. */
  count: number;
  /** Of those, how many have been called, so their history goes too. */
  called: number;
  /** Leads left alone because they carry notes (untouched scope only). */
  kept: number;
};

/** Ids of leads that have any note or call history entry. */
async function leadIdsWithNotes(supabase: SupabaseClient): Promise<Set<string> | Failure> {
  const ids = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("call_lead_notes")
      .select("lead_id")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { error: error.message, status: 500 };
    for (const r of data ?? []) ids.add(r.lead_id as string);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

/** Every lead id matching a scope's filter, read page by page. */
async function candidateIds(supabase: SupabaseClient, scope: PurgeScope): Promise<string[] | Failure> {
  const out: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase.from("call_leads").select("id");
    if (scope === "untouched") q = q.eq("status", "new").eq("attempts", 0);
    const { data, error } = await q.order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { error: error.message, status: 500 };
    for (const r of data ?? []) out.push(r.id as string);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function previewPurge(supabase: SupabaseClient, scope: PurgeScope): Promise<PurgeSummary | Failure> {
  if (scope === "untouched") {
    const candidates = await candidateIds(supabase, scope);
    if (isFailure(candidates)) return candidates;
    const withNotes = await leadIdsWithNotes(supabase);
    if (isFailure(withNotes)) return withNotes;
    const doomed = candidates.filter((id) => !withNotes.has(id));
    return { count: doomed.length, called: 0, kept: candidates.length - doomed.length };
  }
  const finished = scope === "finished";
  const all = supabase.from("call_leads").select("id", { count: "exact", head: true });
  const { count } = await (finished ? all.in("status", FINISHED_STATUSES) : all.not("id", "is", null));
  const calledQ = supabase.from("call_leads").select("id", { count: "exact", head: true }).gt("attempts", 0);
  const { count: called } = await (finished ? calledQ.in("status", FINISHED_STATUSES) : calledQ);
  return { count: count ?? 0, called: called ?? 0, kept: 0 };
}

export async function runPurge(
  supabase: SupabaseClient,
  scope: PurgeScope,
): Promise<{ deleted: number; kept: number } | Failure> {
  if (scope === "untouched") {
    const candidates = await candidateIds(supabase, scope);
    if (isFailure(candidates)) return candidates;
    const withNotes = await leadIdsWithNotes(supabase);
    if (isFailure(withNotes)) return withNotes;
    const doomed = candidates.filter((id) => !withNotes.has(id));

    const chunks: string[][] = [];
    for (let i = 0; i < doomed.length; i += DELETE_CHUNK) chunks.push(doomed.slice(i, i + DELETE_CHUNK));
    let deleted = 0;
    for (let i = 0; i < chunks.length; i += DELETE_PARALLEL) {
      const results = await Promise.all(
        chunks.slice(i, i + DELETE_PARALLEL).map((ids) =>
          // Re-check the status in the delete itself, so a lead called a moment ago is never removed.
          supabase.from("call_leads").delete().in("id", ids).eq("status", "new").eq("attempts", 0).select("id"),
        ),
      );
      for (const r of results) {
        if (r.error) return { error: `Deleted ${deleted} before an error: ${r.error.message}`, status: 500 };
        deleted += r.data?.length ?? 0;
      }
    }
    return { deleted, kept: candidates.length - doomed.length };
  }

  const del = supabase.from("call_leads").delete();
  const { data, error } = await (scope === "finished" ? del.in("status", FINISHED_STATUSES) : del.not("id", "is", null)).select("id");
  if (error) return { error: error.message, status: 500 };
  return { deleted: data?.length ?? 0, kept: 0 };
}

/* ── Fill in missing websites on leads already in the list ───────────────── */

export type WebsiteBackfill = {
  /** Leads with no website that now have one (or would, on a dry run). */
  found: number;
  /** Leads that still have none: nothing to match on, or no match. */
  stillMissing: number;
  sample: { business_name: string; website: string; from: "email" | "column" }[];
};

type LeadForSites = {
  id: string; lead_key: string; business_name: string; website: string | null;
  email: string | null; extra: Record<string, string> | null;
};

export async function fillMissingWebsites(
  supabase: SupabaseClient,
  dryRun: boolean,
): Promise<WebsiteBackfill | Failure> {
  const rows: LeadForSites[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("call_leads")
      .select("id, lead_key, business_name, website, email, extra")
      .or("website.is.null,website.eq.")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { error: error.message, status: 500 };
    rows.push(...((data ?? []) as LeadForSites[]));
    if (!data || data.length < PAGE) break;
  }

  const updates: { id: string; lead_key: string; business_name: string; website: string; extra: Record<string, string> }[] = [];
  const sample: WebsiteBackfill["sample"] = [];
  for (const r of rows) {
    if (!isMissingWebsite(r.website)) continue;
    const guess = guessWebsite({ business_name: r.business_name, email: r.email, extra: r.extra });
    if (!guess) continue;
    updates.push({
      id: r.id,
      lead_key: r.lead_key,
      business_name: r.business_name,
      website: guess.url,
      extra: { ...(r.extra ?? {}), [WEBSITE_FROM_KEY]: guess.from },
    });
    if (sample.length < 8) sample.push({ business_name: r.business_name, website: guess.url, from: guess.from });
  }

  if (!dryRun) {
    // Upsert on the primary key with only the columns being changed (plus the two
    // required identity columns, written back unchanged) — a handful of requests, not one per lead.
    for (let i = 0; i < updates.length; i += 200) {
      const { error } = await supabase.from("call_leads").upsert(updates.slice(i, i + 200), { onConflict: "id" });
      if (error) return { error: `Updated ${i} before an error: ${error.message}`, status: 500 };
    }
  }
  return { found: updates.length, stillMissing: rows.length - updates.length, sample };
}
