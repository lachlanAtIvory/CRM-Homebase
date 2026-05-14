/**
 * Pure pricing helpers. Shared between the server action (which writes
 * deal_value_aud and computes invoice totals) and the client form (which
 * shows the live Quote Summary). Same maths = no drift.
 */

/** Returns the amount AFTER a percentage discount, rounded to 2dp. */
export function applyDiscount(amount: number, percent: number): number {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const result = amount * (1 - p / 100);
  return Math.round(result * 100) / 100;
}

/** Full quote breakdown including discount + GST. Used in the Quote Summary,
 *  the invoice email, and the PDF — all from one place. */
export type QuoteBreakdown = {
  upfront_subtotal:        number;
  monthly_subtotal:        number;
  discount_percent:        number;
  discount_upfront_amount: number;
  discount_monthly_amount: number;
  upfront_after_discount:  number;
  monthly_after_discount:  number;
  gst_amount:              number;
  total_payable_now:       number;
};

export function calcQuote(
  upfront: number,
  monthly: number,
  discountPercent: number,
): QuoteBreakdown {
  const upfrontAfter = applyDiscount(upfront, discountPercent);
  const monthlyAfter = applyDiscount(monthly, discountPercent);
  const discountUp   = Math.round((upfront - upfrontAfter) * 100) / 100;
  const discountMo   = Math.round((monthly - monthlyAfter) * 100) / 100;
  const gst          = Math.round(upfrontAfter * 0.10 * 100) / 100;
  const total        = Math.round((upfrontAfter + gst) * 100) / 100;
  return {
    upfront_subtotal:        upfront,
    monthly_subtotal:        monthly,
    discount_percent:        discountPercent || 0,
    discount_upfront_amount: discountUp,
    discount_monthly_amount: discountMo,
    upfront_after_discount:  upfrontAfter,
    monthly_after_discount:  monthlyAfter,
    gst_amount:              gst,
    total_payable_now:       total,
  };
}
