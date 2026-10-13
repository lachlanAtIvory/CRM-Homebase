import { QuoteBuilder } from "./quote-builder";

/**
 * Quote Builder — build a quote live on a sales call.
 *
 * Prices and rules live in src/lib/hq/quote-config.ts (change a number there
 * and the whole builder follows); the pricing engine is src/lib/hq/quote-math.ts.
 * Drafts and saved quotes are kept in this browser's localStorage.
 */
export default function QuotePage() {
  return <QuoteBuilder />;
}
