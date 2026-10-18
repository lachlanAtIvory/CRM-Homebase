import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { can } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadEditorData } from "@/lib/hq/availability-admin";
import { AvailabilityEditor } from "./availability-editor";

/**
 * Settings > Call availability: when Ryan and Lachlan can take sales calls.
 * The cold caller can only book from these times (minus anything already on
 * the shared calendar). Managers only.
 */
export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  if (!access.ok || !can(access.access, "manager")) redirect("/");

  const data = await loadEditorData(adminClient());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-xs font-semibold text-muted-foreground hover:text-foreground">← Settings</Link>
        <h1 className="mt-1 text-2xl font-bold">Call availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The hours you and Ryan can take sales calls, in Sydney time. When the cold caller books a call he can only pick from these times,
          and anything already on the shared calendar is taken off automatically.
        </p>
      </div>
      <AvailabilityEditor initial={data} />
    </div>
  );
}
