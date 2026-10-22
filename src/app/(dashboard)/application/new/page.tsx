import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApplicationForm } from "../_form/application-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A new application. Opened from a client (?client=<id>) it starts filled in with
 * that client's details, and if that client already has an application it opens
 * that one instead, so a client never ends up with two.
 */
export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client: clientParam } = await searchParams;
  const supabase = await createClient();

  let clientId: string | undefined;
  let initialValues: Record<string, string> | undefined;
  let clientName: string | undefined;

  if (typeof clientParam === "string" && UUID.test(clientParam)) {
    const { data: client } = await supabase
      .from("clients")
      .select("id, company_name, contact_name, email, phone")
      .eq("id", clientParam)
      .maybeSingle();
    if (client) {
      const { data: existing } = await supabase
        .from("applications")
        .select("id")
        .eq("client_id", client.id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (existing?.[0]?.id) redirect(`/application/${existing[0].id}`);

      clientId = client.id as string;
      clientName = client.company_name as string;
      initialValues = {
        company_name:  (client.company_name as string | null) ?? "",
        owner_name:    (client.contact_name as string | null) ?? "",
        contact_email: (client.email as string | null) ?? "",
        contact_phone: (client.phone as string | null) ?? "",
      };
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Launch Application{clientName ? ` — ${clientName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What this client is signing up for and how the business runs, so their agent can be built.
          The quickest way to start is the Quote Builder: pick the client, build the quote, and
          push it here so the products and price are already filled in.
        </p>
      </div>

      <ApplicationForm legacyProducts={[]} initialValues={initialValues} clientId={clientId} />
    </div>
  );
}
