import { createClient } from "@/lib/supabase/server";
import { ApplicationForm } from "../_form/application-form";

export default async function NewApplicationPage() {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("key, label, description, upfront_cost_aud, monthly_cost_aud")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  // Cast NUMERIC columns from string → number (Supabase returns NUMERIC as strings)
  const normalised = (products ?? []).map((p) => ({
    key:              p.key as string,
    label:            p.label as string,
    description:      (p.description as string | null) ?? "",
    upfront_cost_aud: Number(p.upfront_cost_aud) || 0,
    monthly_cost_aud: Number(p.monthly_cost_aud) || 0,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Launch Application</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the client and product details. When you submit, an invoice will be
          emailed to the client and a CRM record created automatically.
        </p>
      </div>

      <ApplicationForm products={normalised} />
    </div>
  );
}
