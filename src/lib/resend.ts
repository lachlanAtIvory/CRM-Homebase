import { Resend } from "resend";

// Resend client — used server-side only (never expose API key client-side).
// API key + from email come from env vars; set on Vercel for production.
export const resend = new Resend(process.env.RESEND_API_KEY);

export const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "hello@agentivory.com";

export const COMPANY_NAME = "Agent Ivory";
// Placeholders — update once business details are finalised.
export const COMPANY_ABN  = "ABN: [TBD]";
export const BANK_DETAILS = "Bank details to follow — please reply to this email.";
