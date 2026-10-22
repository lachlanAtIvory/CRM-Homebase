import { QuoteBuilder } from "./quote-builder";
import { openQuoteClient, pushQuoteToClientApplication, saveQuoteToClient, searchQuoteClients } from "./actions";

/**
 * Quote Builder — build a quote live on a sales call.
 *
 * Prices and rules live in src/lib/hq/quote-config.ts (change a number there
 * and the whole builder follows); the pricing engine is src/lib/hq/quote-math.ts.
 *
 * A quote can be tied to a CRM client (the one made when the sales call was
 * booked): it's then kept with them and can be pushed to their application.
 * Unlinked quotes are kept in this browser's localStorage, as before.
 * `?client=<id>` opens the builder with that client already chosen.
 */
const api = { search: searchQuoteClients, open: openQuoteClient, save: saveQuoteToClient, push: pushQuoteToClientApplication };

export default async function QuotePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  return <QuoteBuilder api={api} initialClientId={typeof client === "string" ? client : undefined} />;
}
