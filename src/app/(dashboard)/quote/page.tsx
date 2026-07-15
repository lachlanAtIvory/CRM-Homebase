import { QuoteBuilder } from "./quote-builder";

/**
 * Quote Builder — native CRM version of the internal pricing calculator.
 *
 * Pricing engine lives in src/lib/hq/quote-math.ts (verified 1:1 against the
 * original standalone tool); tunables in src/lib/hq/quote-config.ts. Tuned
 * assumptions persist to localStorage under the same key as the old tool,
 * so previously saved values carry over.
 */
export default function QuotePage() {
  return <QuoteBuilder />;
}
