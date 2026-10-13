import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { nameKey, parseLeadText, type ImportLead } from "@/lib/hq/call-lead-import";
import { isMissingTable } from "@/lib/hq/call-leads";
import { WEBSITE_FROM_KEY } from "@/lib/hq/website-guess";
import { parsePhone } from "@/lib/hq/phone";

/**
 * Call list — import leads pasted or uploaded from the scraped Google Sheet.
 *
 * POST { text, dryRun? }
 *   dryRun: true  -> check only: which columns were recognised, how many
 *                    leads are new vs already in the CRM, plus a sample.
 *   dryRun: false -> insert the new ones.
 *
 * Existing leads are never touched, so the caller's notes and outcomes
 * survive a re-import of the same sheet. A lead counts as "already in the
 * CRM" when its key matches, or when the same business name has the same
 * phone number (the same clinic scraped twice with different map links).
 *
 * TODO(roles): manager-only once roles ship.
 */
export const runtime = "nodejs";

const READ_PAGE = 1000;
const MAX_READ_PAGES = 60;
const INSERT_CHUNK = 500;

/** Every existing lead's identity fields, read page by page (keeps URLs short). */
async function loadExisting(supabase: SupabaseClient) {
  const keys = new Set<string>();
  const phoneName = new Set<string>();
  for (let page = 0; page < MAX_READ_PAGES; page++) {
    const { data, error } = await supabase
      .from("call_leads")
      .select("lead_key, phone_e164, business_name")
      .order("id")
      .range(page * READ_PAGE, page * READ_PAGE + READ_PAGE - 1);
    if (error) return { error };
    for (const r of data ?? []) {
      keys.add(r.lead_key as string);
      if (r.phone_e164) phoneName.add(`${r.phone_e164}|${nameKey(r.business_name as string)}`);
    }
    if (!data || data.length < READ_PAGE) break;
  }
  return { keys, phoneName, error: null };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { text?: unknown; dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Paste your leads first." }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;

  const parsed = parseLeadText(body.text);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const existing = await loadExisting(supabase);
  if (existing.error) {
    const hint = isMissingTable(existing.error)
      ? "The call list tables don't exist yet. Run the call_leads migration in the Supabase SQL editor first."
      : existing.error.message;
    return NextResponse.json({ error: hint }, { status: isMissingTable(existing.error) ? 503 : 500 });
  }

  const fresh: ImportLead[] = parsed.leads.filter(
    (l) =>
      !existing.keys!.has(l.lead_key) &&
      !(l.phone_e164 && existing.phoneName!.has(`${l.phone_e164}|${nameKey(l.business_name)}`)),
  );
  const alreadyInCrm = parsed.leads.length - fresh.length;

  const summary = {
    totalRows: parsed.totalRows,
    newCount: fresh.length,
    alreadyInCrm,
    duplicatesInFile: parsed.duplicatesInFile,
    skippedNoName: parsed.skippedNoName,
    skippedNoPhone: parsed.skippedNoPhone,
    unreadablePhones: fresh.filter((l) => !l.phone_e164 && !parsePhone(l.phone).ok).length,
    // Counted over the genuinely new leads only, not ones already in the CRM.
    websitesFound: fresh.filter((l) => l.extra[WEBSITE_FROM_KEY]).length,
    websiteSample: fresh
      .filter((l) => l.extra[WEBSITE_FROM_KEY])
      .slice(0, 5)
      .map((l) => ({ business_name: l.business_name, website: l.website, from: l.extra[WEBSITE_FROM_KEY] })),
    recognised: parsed.recognised,
    extraHeaders: parsed.extraHeaders,
  };

  if (dryRun) {
    const sample = fresh.slice(0, 5).map((l) => ({
      business_name: l.business_name,
      phone: parsePhone(l.phone).display || l.phone,
      category: l.category,
    }));
    return NextResponse.json({ ok: true, dryRun: true, ...summary, sample });
  }

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    const chunk = fresh.slice(i, i + INSERT_CHUNK).map((l) => ({ ...l, imported_by: user.email ?? null }));
    const { data, error } = await supabase
      .from("call_leads")
      .upsert(chunk, { onConflict: "lead_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      return NextResponse.json(
        { error: `Imported ${inserted} before an error: ${error.message}`, inserted },
        { status: 500 },
      );
    }
    inserted += data?.length ?? 0;
  }
  return NextResponse.json({ ok: true, dryRun: false, inserted, ...summary });
}
