"use server";

import { createClient } from "@/lib/supabase/server";
import { assertAccess } from "@/lib/hq/access-guard";
import { adminClient } from "@/lib/hq/supabase-admin";
import {
  openClientQuote, pushQuoteToApplication, saveClientQuote, searchClients,
  type ClientQuoteView, type QuoteClient, type Result,
} from "@/lib/hq/client-quotes";

/**
 * Quotes tied to a client. Server actions are reachable on their own, so each
 * one checks access itself; the quote lives in a table the person's own session
 * may not be able to read (a member with only Quote Builder can't read clients),
 * so after the check the work is done with the server's own key.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badId: { ok: false; error: string } = { ok: false, error: "That isn't a valid client." };

async function whoIsAsking(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email?.toLowerCase() ?? null;
}

export async function searchQuoteClients(q: string): Promise<Result<{ clients: QuoteClient[] }>> {
  await assertAccess("quote");
  return searchClients(adminClient(), typeof q === "string" ? q : "");
}

export async function openQuoteClient(clientId: string): Promise<Result<{ view: ClientQuoteView }>> {
  await assertAccess("quote");
  if (!UUID.test(clientId)) return badId;
  return openClientQuote(adminClient(), clientId);
}

export async function saveQuoteToClient(clientId: string, state: unknown): Promise<Result<{ updatedAt: string }>> {
  await assertAccess("quote");
  if (!UUID.test(clientId)) return badId;
  return saveClientQuote(adminClient(), clientId, state, await whoIsAsking());
}

/** Pushing writes to the application, so it needs both sections. */
export async function pushQuoteToClientApplication(clientId: string, state: unknown) {
  await assertAccess("quote");
  await assertAccess("applications");
  if (!UUID.test(clientId)) return badId;
  return pushQuoteToApplication(adminClient(), clientId, state, await whoIsAsking());
}
