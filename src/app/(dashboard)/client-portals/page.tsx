import { createClient } from "@/lib/supabase/server";
import { PortalList } from "./portal-list";
import { Link2 } from "lucide-react";

/**
 * Client Portals — manage the public /client/[token] report links.
 *
 * One link per hq_clients row. No login for the client end — the token
 * in the URL is the access control (see src/app/client/[token]/page.tsx).
 */
export default async function ClientPortalsPage() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("hq_clients")
    .select("id, name, vertical, status, portal_token")
    .order("name", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Client Portals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only report links for signed clients — no login required, no transcripts shown.
          Share a link, or regenerate it if it's ever been sent somewhere it shouldn&apos;t.
        </p>
      </div>

      {!clients || clients.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center ring-1 ring-foreground/5">
          <Link2 size={32} className="mx-auto opacity-30" />
          <h2 className="mt-3 text-sm font-semibold">No signed clients yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a row to hq_clients to generate a portal link here.
          </p>
        </div>
      ) : (
        <PortalList clients={clients as never} />
      )}
    </div>
  );
}
