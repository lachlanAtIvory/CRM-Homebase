import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApplicationForm } from "../_form/application-form";

export default async function ApplicationEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: products }, { data: app }] = await Promise.all([
    supabase
      .from("products")
      .select("key, label, description, upfront_cost_aud, monthly_cost_aud")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single(),
  ]);

  if (!app) notFound();

  const normalised = (products ?? []).map((p) => ({
    key:              p.key as string,
    label:            p.label as string,
    description:      (p.description as string | null) ?? "",
    upfront_cost_aud: Number(p.upfront_cost_aud) || 0,
    monthly_cost_aud: Number(p.monthly_cost_aud) || 0,
  }));

  // Hydrate the form's initial values from the saved row
  const initialValues = {
    company_name:        (app.company_name    as string | null) ?? "",
    owner_name:          (app.owner_name      as string | null) ?? "",
    contact_email:       (app.contact_email   as string | null) ?? "",
    contact_phone:       (app.contact_phone   as string | null) ?? "",
    abn:                 (app.abn             as string | null) ?? "",
    trading_address:     (app.trading_address as string | null) ?? "",
    services:            Array.isArray(app.services) ? app.services : [],
    uses_single_calendar: (app.uses_single_calendar ?? null) as boolean | null,
    team_members:        Array.isArray(app.team_members) ? app.team_members : [],
    booking_platform_name:  (app.booking_platform_name  as string | null) ?? "",
    booking_platform_url:   (app.booking_platform_url   as string | null) ?? "",
    booking_platform_notes: (app.booking_platform_notes as string | null) ?? "",
    selected_products:   Array.isArray(app.selected_products) ? app.selected_products : [],
    discount_percent:    Number(app.discount_percent ?? 0) || 0,
    discount_reason:     (app.discount_reason as string | null) ?? "",
    goals:               (app.goals        as string | null) ?? "",
    requirements:        (app.requirements as string | null) ?? "",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Application — {initialValues.company_name || "Untitled"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Editing an existing application. Changes save automatically when you click
          Save Draft.
        </p>
      </div>

      <ApplicationForm
        products={normalised}
        initialValues={initialValues}
        applicationId={app.id as string}
      />
    </div>
  );
}
