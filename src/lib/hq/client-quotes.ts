import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreState, type QuoteState } from "./quote-config";
import { applicationPatchFromQuote, productKeysFromQuote, summarizeQuote } from "./quote-to-application";

/**
 * Quotes that belong to a CRM client.
 *
 * A quote is built in the Quote Builder. When it's tied to a client it's kept
 * on the server (one live quote per client), so it follows the client around
 * instead of living in one browser, and it can be pushed to that client's
 * application without anything being typed twice.
 *
 * Callers check the person's access first and pass the service-role client.
 */

export type QuoteClient = {
  id: string;
  company_name: string;
  email: string | null;
  /** The client's pipeline stage, if they have a deal. */
  stage: string | null;
  hasQuote: boolean;
  applicationId: string | null;
};

export type ClientQuoteView = {
  client: { id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null };
  /** null when this client has no saved quote yet. */
  state: QuoteState | null;
  updatedAt: string | null;
  updatedBy: string | null;
  application: { id: string; status: string; pushedAt: string | null } | null;
};

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Strip characters that have meaning inside a PostgREST filter string. */
function safeSearch(q: string): string {
  return q.replace(/[,()%*\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const SEARCH_LIMIT = 20;

/** The database error for "the migration hasn't been run yet", said in plain words. */
export function friendlyError(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (/(client_quotes|quote_snapshot|quote_pushed_at)/.test(m) && /(does not exist|schema cache|could not find)/i.test(m)) {
    return "One setup step left: run supabase/migrations/20261023140000_add_client_quotes.sql in the Supabase SQL editor, then try again.";
  }
  return m || fallback;
}

/** Clients to pick from, most recently touched first. */
export async function searchClients(admin: SupabaseClient, q: string): Promise<Result<{ clients: QuoteClient[] }>> {
  const term = safeSearch(q);
  let query = admin.from("clients").select("id, company_name, email").order("updated_at", { ascending: false }).limit(SEARCH_LIMIT);
  if (term) query = query.ilike("company_name", `%${term}%`);
  const { data: rows, error } = await query;
  if (error) return { ok: false, error: error.message };
  const clients = (rows ?? []) as { id: string; company_name: string; email: string | null }[];
  if (clients.length === 0) return { ok: true, clients: [] };
  const ids = clients.map((c) => c.id);

  const [deals, quotes, apps] = await Promise.all([
    admin.from("deals").select("client_id, current_stage").in("client_id", ids).order("created_at", { ascending: false }),
    admin.from("client_quotes").select("client_id").in("client_id", ids),
    admin.from("applications").select("id, client_id").in("client_id", ids).order("updated_at", { ascending: false }),
  ]);

  const stage = new Map<string, string>();
  for (const d of (deals.data ?? []) as { client_id: string; current_stage: string }[]) if (!stage.has(d.client_id)) stage.set(d.client_id, d.current_stage);
  const hasQuote = new Set(((quotes.data ?? []) as { client_id: string }[]).map((r) => r.client_id));   // a missing table just means none yet
  const appId = new Map<string, string>();
  for (const a of (apps.data ?? []) as { id: string; client_id: string }[]) if (!appId.has(a.client_id)) appId.set(a.client_id, a.id);

  return {
    ok: true,
    clients: clients.map((c) => ({
      id: c.id,
      company_name: c.company_name,
      email: c.email ?? null,
      stage: stage.get(c.id) ?? null,
      hasQuote: hasQuote.has(c.id),
      applicationId: appId.get(c.id) ?? null,
    })),
  };
}

async function latestApplication(admin: SupabaseClient, clientId: string) {
  const { data } = await admin
    .from("applications")
    .select("id, status, quote_pushed_at, booking_platform_name")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1);
  return (data?.[0] ?? null) as { id: string; status: string; quote_pushed_at: string | null; booking_platform_name: string | null } | null;
}

export async function openClientQuote(admin: SupabaseClient, clientId: string): Promise<Result<{ view: ClientQuoteView }>> {
  const { data: client, error } = await admin.from("clients").select("id, company_name, contact_name, email, phone").eq("id", clientId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!client) return { ok: false, error: "That client no longer exists." };

  const { data: quote } = await admin.from("client_quotes").select("state, updated_at, updated_by").eq("client_id", clientId).maybeSingle();
  const app = await latestApplication(admin, clientId);

  return {
    ok: true,
    view: {
      client: client as ClientQuoteView["client"],
      state: quote?.state ? restoreState(quote.state) : null,
      updatedAt: (quote?.updated_at as string | undefined) ?? null,
      updatedBy: (quote?.updated_by as string | undefined) ?? null,
      application: app ? { id: app.id, status: app.status, pushedAt: app.quote_pushed_at } : null,
    },
  };
}

/** Keep this client's quote (one per client: saving again replaces it). */
export async function saveClientQuote(
  admin: SupabaseClient,
  clientId: string,
  input: unknown,
  by: string | null,
): Promise<Result<{ updatedAt: string }>> {
  const { data: client, error: cErr } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (cErr) return { ok: false, error: cErr.message };
  if (!client) return { ok: false, error: "That client no longer exists." };

  const state = restoreState(input);       // anything odd in what the browser sent becomes a safe default
  const row = { state, summary: summarizeQuote(state), updated_by: by };

  const { data: existing, error: sErr } = await admin.from("client_quotes").select("id").eq("client_id", clientId).maybeSingle();
  if (sErr) return { ok: false, error: friendlyError(sErr.message, "Couldn't save the quote.") };

  if (existing?.id) {
    const { data, error } = await admin.from("client_quotes").update(row).eq("id", existing.id).select("updated_at").single();
    if (error || !data) return { ok: false, error: friendlyError(error?.message, "Couldn't save the quote.") };
    return { ok: true, updatedAt: data.updated_at as string };
  }
  const { data, error } = await admin.from("client_quotes").insert({ client_id: clientId, ...row }).select("updated_at").single();
  if (error || !data) return { ok: false, error: friendlyError(error?.message, "Couldn't save the quote.") };
  return { ok: true, updatedAt: data.updated_at as string };
}

/**
 * Save the quote to the client, then copy what it decided into the client's application:
 * the products to build, the price, and the quote itself (kept with the application).
 * If the client has no application yet, one is started with the client's details.
 * Everything else on an existing application (team, goals, requirements...) is left alone.
 */
export async function pushQuoteToApplication(
  admin: SupabaseClient,
  clientId: string,
  input: unknown,
  by: string | null,
  now: Date = new Date(),
): Promise<Result<{ applicationId: string; created: boolean; status: string; products: number }>> {
  const state = restoreState(input);
  if (productKeysFromQuote(state).length === 0) {
    return { ok: false, error: "Pick at least one product to build before pushing this to the application." };
  }

  const saved = await saveClientQuote(admin, clientId, state, by);
  if (!saved.ok) return saved;

  const { data: client } = await admin.from("clients").select("id, company_name, contact_name, email, phone").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "That client no longer exists." };

  const patch = applicationPatchFromQuote(state, now);
  const pms = state.pmsName.trim();
  const existing = await latestApplication(admin, clientId);

  if (existing) {
    const update: Record<string, unknown> = { ...patch };
    if (pms && !(existing.booking_platform_name ?? "").trim()) update.booking_platform_name = pms;   // never overwrite what's been typed
    const { error } = await admin.from("applications").update(update).eq("id", existing.id);
    if (error) return { ok: false, error: friendlyError(error.message, "Couldn't update the application.") };
    return { ok: true, applicationId: existing.id, created: false, status: existing.status, products: patch.selected_products.length };
  }

  const { data: made, error } = await admin
    .from("applications")
    .insert({
      client_id: clientId,
      company_name: client.company_name as string,
      owner_name: (client.contact_name as string | null) ?? null,
      contact_email: (client.email as string | null) ?? null,
      contact_phone: (client.phone as string | null) ?? null,
      booking_platform_name: pms || null,
      status: "draft",
      ...patch,
    })
    .select("id")
    .single();
  if (error || !made) return { ok: false, error: friendlyError(error?.message, "Couldn't start the application.") };
  return { ok: true, applicationId: made.id as string, created: true, status: "draft", products: patch.selected_products.length };
}

/** What the Quote Builder screen needs from the server. The page passes the real actions; a test page can pass fakes. */
export type QuoteClientApi = {
  search: (q: string) => Promise<Result<{ clients: QuoteClient[] }>>;
  open: (clientId: string) => Promise<Result<{ view: ClientQuoteView }>>;
  save: (clientId: string, state: QuoteState) => Promise<Result<{ updatedAt: string }>>;
  push: (clientId: string, state: QuoteState) => Promise<Result<{ applicationId: string; created: boolean; status: string; products: number }>>;
};
