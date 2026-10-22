"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { applyDiscount } from "./pricing";
import { assertAccess } from "@/lib/hq/access-guard";

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
  // OPTIONAL: the CRM client this application is for (opened from the client or pushed from a quote).
  // When set it is used as the client, instead of guessing from the email.
  client_id?:        string;
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
  // Quote totals (snapshot, pre-discount)
  upfront_total_aud: number;
  monthly_total_aud: number;
  // Discount applied to both upfront + monthly. 0 = no discount.
  discount_percent: number;
  discount_reason:  string;
  // Goals
  goals:            string;
  requirements:     string;
};

export type SubmitResult =
  | {
      ok: true;
      application_id: string;
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
  // Server actions are reachable on their own, so each one checks access itself.
  await assertAccess("applications");
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
    discount_percent:       input.discount_percent,
    discount_reason:        input.discount_reason.trim() || null,
    goals:                  input.goals.trim()        || null,
    requirements:           input.requirements.trim() || null,
  };

  // Dedup check: if no application_id was given (i.e. brand new save) and
  // this email matches a client who already has an application, merge into
  // that existing one instead of creating a duplicate.
  const existingForClient = input.application_id
    ? null
    : await findExistingAppForClient(supabase, input);
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

  return { ok: true, application_id: appId, merged: mergedFlag };
}

// ---------------------------------------------------------------------------
// Submit — saves the application as submitted and makes sure a CRM client and
// a "quoted" deal exist. It does NOT email an invoice: invoicing happens
// outside the CRM.
// ---------------------------------------------------------------------------
export async function submitApplication(input: ApplicationInput): Promise<SubmitResult> {
  // Server actions are reachable on their own, so each one checks access itself.
  await assertAccess("applications");
  const supabase = await createClient();

  const validation = validate(input);
  if (validation) return { ok: false, error: validation };

  // 1. Save the application row — UPDATE existing or INSERT new
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
    discount_percent:       input.discount_percent,
    discount_reason:        input.discount_reason.trim() || null,
    goals:                  input.goals.trim()        || null,
    requirements:           input.requirements.trim() || null,
    status:                 "submitted",
  };

  // Dedup check (same logic as saveDraft): if this is a brand-new submit and
  // the email matches a client who already has an application, update that
  // one rather than creating a duplicate.
  const existingForClient = input.application_id
    ? null
    : await findExistingAppForClient(supabase, input);
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

  // 3. Upsert a single 'quoted' deal for this client. The value is the one-off setup,
  // excluding GST. When a quote was pushed to this application its price already includes
  // its own discount; the old per-application discount only applies to old, catalogue-priced ones.
  const { data: saved } = await supabase
    .from("applications")
    .select("quote_snapshot")
    .eq("id", app.id)
    .maybeSingle();
  const hasQuote = !!saved?.quote_snapshot;
  const dealValue = hasQuote ? input.upfront_total_aud : applyDiscount(input.upfront_total_aud, input.discount_percent);
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
        .update({ deal_value_aud: dealValue })
        .eq("id", existingDeal.id);
    } else {
      await supabase
        .from("deals")
        .insert({
          client_id:      clientId,
          current_stage:  "quoted",
          deal_value_aud: dealValue,
        });
    }
  }

  return { ok: true, application_id: app.id, merged: mergedFlag };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(input: ApplicationInput): string | null {
  if (!input.company_name.trim()) return "Company name is required.";
  if (input.client_id && !UUID.test(input.client_id)) return "That client isn't valid.";
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

  // The client this application was opened for is the client, whatever the email says.
  if (input.client_id) {
    const { data: chosen } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.client_id)
      .maybeSingle();
    if (chosen?.id) clientId = chosen.id;
  }

  // Match by email if present — this can switch the link to a different
  // client if the user changed the email to one that matches a real client
  if (!clientId && email) {
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
// Dedup helper — finds the client (the one the form was opened for, else the one
// with this email) and returns the id of their most recent application (if any).
// Used to merge a fresh save into an existing app rather than creating a
// duplicate per client.
// ---------------------------------------------------------------------------
async function findExistingAppForClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input:    ApplicationInput,
): Promise<string | null> {
  let client: { id: string } | null = null;

  if (input.client_id) {
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.client_id)
      .maybeSingle();
    client = data ?? null;
  }

  if (!client) {
    const trimmed = input.contact_email.trim();
    if (!trimmed) return null;
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("email", trimmed)
      .maybeSingle();
    client = data ?? null;
  }

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
