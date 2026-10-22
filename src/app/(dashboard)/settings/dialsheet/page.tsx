import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { can } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadDialSheetStatus } from "@/lib/hq/dialsheet-events";
import { DialSheetStatusView } from "./dialsheet-status";

/**
 * Settings > DialSheet — is the dialler wired up, and is DialSheet talking to us?
 * Managers only. The middleware turns everyone else away; this checks again.
 */
export const dynamic = "force-dynamic";

export default async function DialSheetSettingsPage() {
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  if (!access.ok || !can(access.access, "manager")) redirect("/");

  const status = await loadDialSheetStatus(adminClient());

  // The address DialSheet must be told to send calls to: this site, on whatever host the manager is using.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${proto}://${host}/api/dialsheet/webhook`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-xs font-semibold text-muted-foreground hover:text-foreground">← Settings</Link>
        <h1 className="mt-1 text-2xl font-bold">DialSheet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every call Jan makes in DialSheet is logged on the lead it was for. This page shows whether the connection is working.
        </p>
      </div>
      <DialSheetStatusView status={status} webhookUrl={webhookUrl} />
    </div>
  );
}
