"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resend, FROM_EMAIL, COMPANY_NAME } from "@/lib/resend";
import { renderInvoiceHTML, type InvoiceData } from "@/lib/invoice-template";

// One service the business offers. Listed up-top so team members can be
// assigned to them by id.
export type Service = {
  id:   string;  // crypto.randomUUID() generated client-side
  name: string;
};

export type TeamMember = {
  name:                  string;
  position:              string;
  // Selected service ids (multi-select) + optional 'Other' freeform text
  service_ids?:          string[];
  other_services?:       string;
  // When uses_single_calendar = true → optional separate calendar on top
  has_separate_calendar?: boolean;
  // When uses_single_calendar = false → integrate this person's calendar into the agent?
  integrate_calendar?:   boolean;
};

export type ApplicationInput = {
  // OPTIONAL: when set we UPDATE the existing row, otherwise INSERT a new one
  application_id?:   string;
  // Client Details
  company_name:     string;
  owner_name:       string;
  contact_email:    string;
  contact_phone:    string;
  // Business
  abn:              string;
  trading_address:  string;
  // Services offered by the business (drives team member assignments)
  services:         Service[];
  // Team & calendars
  uses_single_calendar: boolean | null;
  team_members:         TeamMember[];
  // Booking platform the client currently uses
  booking_platform_name:  string;
  booking_platform_url:   string;
  booking_platform_notes: string;
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
  | {
      ok: true;
      application_id: string;
      invoice_sent: boolean;
      /**
       * True when the action found an existing application for the same
       * client (matched by email) and updated it rather than creating a
       * duplicate. Lets the form surface "opened existing application"
       * feedback instead of a silent merge.
       */
      merged?: boolean;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Save as draft — UPSERT (insert new row OR update existing if application_id
// is supplied). No email sent.
// ---------------------------------------------------------------------------
export async function saveDraft(input: ApplicationInput): Promise<SubmitResult> {
  const supabase = await createClient();

  const validation = validate(input);
  if (validation) return { ok: false, error: validation };

  const row = {
    company_name:           input.company_name.trim(),
    owner_name:             input.owner_name.trim()      || null,
    contact_email:          input.contact_email.trim()   || null,
    contact_phone:          input.contact_phone.trim()   || null,
    abn:                    input.abn.trim()             || null,
    trading_address:        input.trading_address.trim() || null,
    services:               input.services,
    uses_single_calendar:   input.uses_single_calendar,
    team_members:           input.team_members,
    booking_platform_name:  input.booking_platform_name.trim()  || null,
    booking_platform_url:   input.booking_platform_url.trim()   || null,
    booking_platform_notes: input.booking_platform_notes.trim() || null,
    selected_products:      input.selected_products,
    upfront_total_aud:      input.upfront_total_aud,
    monthly_total_aud:      input.monthly_total_aud,
    goals:                  input.goals.trim()        || null,
    requirements:           input.requirements.trim() || null,
  };

  // Dedup check: if no application_id was given (i.e. brand new save) and
  // this email matches a client who already has an application, merge into
  // that existing one instead of creating a duplicate.
  const existingForClient = input.application_id
    ? null
    : await findExistingAppForClientByEmail(supabase, input.contact_email);
  const mergedFlag = !!existingForClient;

  let appId: string;
  if (input.application_id || existingForClient) {
    const targetId = input.application_id ?? existingForClient!;
    const { error } = await supabase
      .from("applications")
      .update(row)
      .eq("id", targetId);
    if (error) return { ok: false, error: error.message };
    appId = targetId;
  } else {
    // INSERT — no existing app to merge into
    const { data, error } = await supabase
      .from("applications")
      .insert({ ...row, status: "draft" })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Could not save application." };
    }
    appId = data.id;
  }

  // Link the application to a CRM client — so drafts show up on the client
  // detail page. We match by email (preferred) or create a new client if
  // there's a company name to anchor it to.
  await linkApplicationToClient(appId, input);

  return { ok: true, application_id: appId, invoice_sent: false, merged: mergedFlag };
}

// ---------------------------------------------------------------------------
// Submit — saves the application, ensures a CRM client + deal exist,
// then sends the invoice email via Resend.
// ---------------------------------------------------------------------------
export async function submitApplication(input: ApplicationInput): Promise<SubmitResult> {
  const supabase = await createClient();

  const validation = validate(input);
  if (validation) return { ok: false, error: validation };

  // 1. Save the application row — UPDATE existing or INSERT new — so we
  // have an ID for the invoice number
  const baseRow = {
    company_name:           input.company_name.trim(),
    owner_name:             input.owner_name.trim()      || null,
    contact_email:          input.contact_email.trim()   || null,
    contact_phone:          input.contact_phone.trim()   || null,
    abn:                    input.abn.trim()             || null,
    trading_address:        input.trading_address.trim() || null,
    services:               input.services,
    uses_single_calendar:   input.uses_single_calendar,
    team_members:           input.team_members,
    booking_platform_name:  input.booking_platform_name.trim()  || null,
    booking_platform_url:   input.booking_platform_url.trim()   || null,
    booking_platform_notes: input.booking_platform_notes.trim() || null,
    selected_products:      input.selected_products,
    upfront_total_aud:      input.upfront_total_aud,
    monthly_total_aud:      input.monthly_total_aud,
    goals:                  input.goals.trim()        || null,
    requirements:           input.requirements.trim() || null,
    status:                 "submitted",
  };

  // Dedup check (same logic as saveDraft): if this is a brand-new submit and
  // the email matches a client who already has an application, update that
  // one rather than creating a duplicate.
  const existingForClient = input.application_id
    ? null
    : await findExistingAppForClientByEmail(supabase, input.contact_email);
  const mergedFlag = !!existingForClient;

  let appId: string;
  if (input.application_id || existingForClient) {
    const targetId = input.application_id ?? existingForClient!;
    const { error: updErr } = await supabase
      .from("applications")
      .update(baseRow)
      .eq("id", targetId);
    if (updErr) return { ok: false, error: updErr.message };
    appId = targetId;
  } else {
    const { data: created, error: insErr } = await supabase
      .from("applications")
      .insert(baseRow)
      .select("id")
      .single();
    if (insErr || !created) {
      return { ok: false, error: insErr?.message ?? "Could not save application." };
    }
    appId = created.id;
  }
  const app = { id: appId };

  // 2. Ensure the application is linked to a CRM client (find by email or create)
  const clientId = await linkApplicationToClient(app.id, input, { updateClient: true });

  // 3. Upsert a single 'quoted' deal for this client. Without this, every
  // resubmission of the same application creates a new duplicate quoted deal
  // for the same client.
  if (clientId) {
    const { data: existingDeal } = await supabase
      .from("deals")
      .select("id")
      .eq("client_id", clientId)
      .eq("current_stage", "quoted")
      .maybeSingle();

    if (existingDeal?.id) {
      await supabase
        .from("deals")
        .update({ deal_value_aud: input.upfront_total_aud })
        .eq("id", existingDeal.id);
    } else {
      await supabase
        .from("deals")
        .insert({
          client_id:      clientId,
          current_stage:  "quoted",
          deal_value_aud: input.upfront_total_aud,
        });
    }
  }

  // 5. Build & send the invoice email
  const invoiceNumber = `INV-${app.id.slice(0, 8).toUpperCase()}`;
  let invoiceSent = false;
  const email = input.contact_email.trim();

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

  return { ok: true, application_id: app.id, invoice_sent: invoiceSent, merged: mergedFlag };
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

// ---------------------------------------------------------------------------
// Resolve the CRM client for this application — find existing by email, or
// create a new one — then write client_id back onto the application row.
//
// Returns the client id so callers (e.g. submitApplication) can chain off it.
// Skips silently if there's not enough info to identify a client.
//
// `updateClient: true` keeps the existing client row in sync with the latest
// form values (used on Submit). On draft saves we don't overwrite the client
// because the form is still partial.
// ---------------------------------------------------------------------------
async function linkApplicationToClient(
  applicationId: string,
  input:         ApplicationInput,
  opts:          { updateClient?: boolean } = {},
): Promise<string | null> {
  const supabase = await createClient();
  const email   = input.contact_email.trim();
  const company = input.company_name.trim();
  const owner   = input.owner_name.trim();
  const phone   = input.contact_phone.trim();
  const notes   = input.requirements.trim();

  // What client (if any) is this application ALREADY linked to? We use this
  // as a fallback so an app that's already attached to a client doesn't
  // get a brand-new duplicate client created on every save when there's
  // no email match to look up.
  const { data: currentApp } = await supabase
    .from("applications")
    .select("client_id")
    .eq("id", applicationId)
    .maybeSingle();
  const currentLinkedId = (currentApp?.client_id as string | null) ?? null;

  let clientId: string | null = null;

  // Match by email if present — this can switch the link to a different
  // client if the user changed the email to one that matches a real client
  if (email) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing?.id) clientId = existing.id;
  }

  // No email match — fall back to whatever client this app was already
  // linked to. This is the key fix: never create a duplicate when there's
  // already a client attached.
  if (!clientId && currentLinkedId) {
    clientId = currentLinkedId;
  }

  // Still nothing — only NOW do we create a brand-new client (first save
  // for a brand-new app with no matching email)
  if (!clientId && company) {
    const { data: created } = await supabase
      .from("clients")
      .insert({
        company_name: company,
        contact_name: owner || null,
        phone:        phone || null,
        email:        email || null,
        notes:        notes || null,
        active_tools: input.selected_products,
      })
      .select("id")
      .single();
    clientId = created?.id ?? null;
  }

  // On Submit we sync the form values back onto the linked client
  // (so e.g. an updated company name flows through). Drafts don't, since
  // their values are still partial.
  if (clientId && opts.updateClient) {
    await supabase
      .from("clients")
      .update({
        company_name: company,
        contact_name: owner || null,
        phone:        phone || null,
        email:        email || null,
        notes:        notes || null,
        active_tools: input.selected_products,
      })
      .eq("id", clientId);
  }

  // Write the link back onto the application (only if it changed)
  if (clientId && clientId !== currentLinkedId) {
    await supabase
      .from("applications")
      .update({ client_id: clientId })
      .eq("id", applicationId);
  }

  return clientId;
}

// ---------------------------------------------------------------------------
// Dedup helper — looks up a client by email and returns the id of their most
// recent application (if any). Used to merge a fresh save into an existing
// app rather than creating a duplicate per client.
// ---------------------------------------------------------------------------
async function findExistingAppForClientByEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email:    string,
): Promise<string | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("email", trimmed)
    .maybeSingle();

  if (!client?.id) return null;

  const { data: app } = await supabase
    .from("applications")
    .select("id")
    .eq("client_id", client.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return app?.id ?? null;
}

// Action used as a fallback redirect target if a server action ever throws.
export async function backToCrm() {
  redirect("/");
}
