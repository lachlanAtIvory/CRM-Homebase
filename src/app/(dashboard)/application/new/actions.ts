"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resend, FROM_EMAIL, COMPANY_NAME } from "@/lib/resend";
import { renderInvoiceHTML, type InvoiceData } from "@/lib/invoice-template";

export type TeamMember = {
  name:                  string;
  position:              string;
  services:              string;
  // When uses_single_calendar = true → optional separate calendar on top
  has_separate_calendar?: boolean;
  // When uses_single_calendar = false → integrate this person's calendar into the agent?
  integrate_calendar?:   boolean;
};

export type ApplicationInput = {
  // Client Details
  company_name:     string;
  owner_name:       string;
  contact_email:    string;
  contact_phone:    string;
  // Business
  abn:              string;
  trading_address:  string;
  // Team & calendars
  uses_single_calendar: boolean | null;
  team_members:         TeamMember[];
  // Products
  selected_products: string[]; // product keys
  // Quote totals (snapshot)
  upfront_total_aud: number;
  monthly_total_aud: number;
  // Goals
  goals:            string;
  requirements:     string;
};

export type SubmitResult =
  | { ok: true;  application_id: string; invoice_sent: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Save as draft — just persist to applications table, no email sent.
// ---------------------------------------------------------------------------
export async function saveDraft(input: ApplicationInput): Promise<SubmitResult> {
  const supabase = await createClient();

  const validation = validate(input);
  if (validation) return { ok: false, error: validation };

  const { data, error } = await supabase
    .from("applications")
    .insert({
      company_name:         input.company_name.trim(),
      owner_name:           input.owner_name.trim()      || null,
      contact_email:        input.contact_email.trim()   || null,
      contact_phone:        input.contact_phone.trim()   || null,
      abn:                  input.abn.trim()             || null,
      trading_address:      input.trading_address.trim() || null,
      uses_single_calendar: input.uses_single_calendar,
      team_members:         input.team_members,
      selected_products:    input.selected_products,
      upfront_total_aud:    input.upfront_total_aud,
      monthly_total_aud:    input.monthly_total_aud,
      goals:                input.goals.trim()        || null,
      requirements:         input.requirements.trim() || null,
      status:            "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not save application." };
  }

  return { ok: true, application_id: data.id, invoice_sent: false };
}

// ---------------------------------------------------------------------------
// Submit — saves the application, ensures a CRM client + deal exist,
// then sends the invoice email via Resend.
// ---------------------------------------------------------------------------
export async function submitApplication(input: ApplicationInput): Promise<SubmitResult> {
  const supabase = await createClient();

  const validation = validate(input);
  if (validation) return { ok: false, error: validation };

  // 1. Save the application row first (so we have an ID for the invoice number)
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .insert({
      company_name:         input.company_name.trim(),
      owner_name:           input.owner_name.trim()      || null,
      contact_email:        input.contact_email.trim()   || null,
      contact_phone:        input.contact_phone.trim()   || null,
      abn:                  input.abn.trim()             || null,
      trading_address:      input.trading_address.trim() || null,
      uses_single_calendar: input.uses_single_calendar,
      team_members:         input.team_members,
      selected_products:    input.selected_products,
      upfront_total_aud:    input.upfront_total_aud,
      monthly_total_aud:    input.monthly_total_aud,
      goals:                input.goals.trim()        || null,
      requirements:         input.requirements.trim() || null,
      status:            "submitted",
    })
    .select("id")
    .single();

  if (appErr || !app) {
    return { ok: false, error: appErr?.message ?? "Could not save application." };
  }

  // 2. Upsert a CRM client by email (if email present) — otherwise create new
  let clientId: string | null = null;
  const email = input.contact_email.trim();

  if (email) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing?.id) {
      // Update existing client with any new info
      clientId = existing.id;
      await supabase
        .from("clients")
        .update({
          company_name: input.company_name.trim(),
          contact_name: input.owner_name.trim() || null,
          phone:        input.contact_phone.trim() || null,
          website:      null,
          notes:        input.requirements.trim() || null,
          active_tools: input.selected_products,
        })
        .eq("id", existing.id);
    }
  }

  if (!clientId) {
    const { data: created } = await supabase
      .from("clients")
      .insert({
        company_name: input.company_name.trim(),
        contact_name: input.owner_name.trim() || null,
        phone:        input.contact_phone.trim() || null,
        email:        email || null,
        notes:        input.requirements.trim() || null,
        active_tools: input.selected_products,
      })
      .select("id")
      .single();
    clientId = created?.id ?? null;
  }

  // 3. Create a deal in the "quoted" stage with the upfront amount
  if (clientId) {
    await supabase
      .from("deals")
      .insert({
        client_id:      clientId,
        current_stage:  "quoted",
        deal_value_aud: input.upfront_total_aud,
      });
  }

  // 4. Link the application to the client
  if (clientId) {
    await supabase
      .from("applications")
      .update({ client_id: clientId })
      .eq("id", app.id);
  }

  // 5. Build & send the invoice email
  const invoiceNumber = `INV-${app.id.slice(0, 8).toUpperCase()}`;
  let invoiceSent = false;

  if (email) {
    try {
      const productLines = await fetchSelectedProductsForInvoice(input.selected_products);
      const upfrontSubtotal = input.upfront_total_aud;
      const gstAmount       = upfrontSubtotal * 0.10;
      const totalNow        = upfrontSubtotal + gstAmount;

      const today = new Date();
      const due   = new Date(today);
      due.setDate(due.getDate() + 14);

      const data: InvoiceData = {
        invoice_number:   invoiceNumber,
        issue_date:       fmtDate(today),
        due_date:         fmtDate(due),
        bill_to_name:     input.owner_name.trim(),
        bill_to_company:  input.company_name.trim(),
        bill_to_email:    email,
        bill_to_address:  input.trading_address.trim() || null,
        bill_to_abn:      input.abn.trim() || null,
        line_items:       productLines,
        upfront_subtotal: upfrontSubtotal,
        monthly_subtotal: input.monthly_total_aud,
        gst_rate:         0.10,
        gst_amount:       gstAmount,
        total_payable_now: totalNow,
      };

      const html = renderInvoiceHTML(data);

      const send = await resend.emails.send({
        from:    `${COMPANY_NAME} <${FROM_EMAIL}>`,
        to:      [email],
        replyTo: FROM_EMAIL,
        subject: `${invoiceNumber} — ${COMPANY_NAME} application`,
        html,
      });

      if (!send.error) {
        invoiceSent = true;
        await supabase
          .from("applications")
          .update({
            invoice_number:  invoiceNumber,
            invoice_sent_at: new Date().toISOString(),
            status:          "invoiced",
          })
          .eq("id", app.id);
      } else {
        console.error("Resend send error:", send.error);
      }
    } catch (e) {
      console.error("Invoice email failed:", e);
    }
  }

  return { ok: true, application_id: app.id, invoice_sent: invoiceSent };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchSelectedProductsForInvoice(
  keys: string[],
): Promise<{ label: string; upfront_aud: number; monthly_aud: number }[]> {
  if (keys.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("key, label, upfront_cost_aud, monthly_cost_aud")
    .in("key", keys);

  return (data ?? []).map((p) => ({
    label:       p.label,
    upfront_aud: Number(p.upfront_cost_aud) || 0,
    monthly_aud: Number(p.monthly_cost_aud) || 0,
  }));
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function validate(input: ApplicationInput): string | null {
  if (!input.company_name.trim()) return "Company name is required.";
  if (input.contact_email && !/^\S+@\S+\.\S+$/.test(input.contact_email.trim())) {
    return "Contact email looks invalid.";
  }
  return null;
}

// Action used as a fallback redirect target if a server action ever throws.
export async function backToCrm() {
  redirect("/");
}
