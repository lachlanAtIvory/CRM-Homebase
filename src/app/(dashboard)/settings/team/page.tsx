import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { can } from "@/lib/hq/access";
import { adminClient } from "@/lib/hq/supabase-admin";
import { loadTeam } from "@/lib/hq/team-admin";
import { TeamManager } from "./team-manager";

/**
 * Settings > Team — who can sign in and what each person can see.
 * Managers only (Ryan and Lachlan). The middleware turns everyone else away;
 * this checks again.
 */
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  if (!access.ok || !can(access.access, "manager")) redirect("/");

  const team = await loadTeam(adminClient());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-xs font-semibold text-muted-foreground hover:text-foreground">← Settings</Link>
        <h1 className="mt-1 text-2xl font-bold">Team access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose who can sign in and exactly what each person can see. Changes apply straight away, with no sign-out needed.
        </p>
      </div>
      <TeamManager initial={team} />
    </div>
  );
}
