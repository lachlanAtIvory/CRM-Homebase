-- Add optional discount to the application quote.
-- discount_percent applies to BOTH the upfront subtotal AND the monthly
-- retainer (because friends/family discounts usually scale across both).
-- GST is calculated on the post-discount upfront amount.

ALTER TABLE public.applications
  ADD COLUMN discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_reason  TEXT;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_discount_percent_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100);
