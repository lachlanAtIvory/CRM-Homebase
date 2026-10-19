import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { can } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadJustCallStatus } from "@/lib/hq/justcall-events";
import { JustCallStatusView } from "./justcall-status";

/**
 * Settings > JustCall — is the dialler wired up, and is JustCall talking to us?
 * Managers only. The middleware turns everyone else away; this checks again.
 */
export const dynamic = "force-dynamic";

export default async function JustCallSettingsPage() {
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  if (!access.ok || !can(access.access, "manager")) redirect("/");

  const status = await loadJustCallStatus(adminClient());

  // The address JustCall must be told to send calls to: this site, on whatever host the manager is using.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${proto}://${host}/api/justcall/webhook`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-xs font-semibold text-muted-foreground hover:text-foreground">← Settings</Link>
        <h1 className="mt-1 text-2xl font-bold">JustCall</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Click-to-dial from the Call List, with every call logged on the lead it was for. This page shows whether the connection is working.
        </p>
      </div>
      <JustCallStatusView status={status} webhookUrl={webhookUrl} />
    </div>
  );
}
