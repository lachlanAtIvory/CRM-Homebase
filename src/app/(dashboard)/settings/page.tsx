import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAccess } from "@/lib/hq/access-server";
import { can } from "@/lib/hq/access";
import { Users } from "lucide-react";
import { EmailSnippets } from "./email-snippets";

export default async function SettingsPage() {
  const supabase = await createClient();
  const access = await getCurrentAccess(supabase);
  const isManager = access.ok && can(access.access, "manager");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable assets for outreach + day-to-day team workflows.
        </p>
      </div>

      {isManager && (
        <Link
          href="/settings/team"
          className="group flex items-center gap-4 rounded-xl border bg-card p-5 ring-1 ring-foreground/5 transition-all hover:border-primary/50 hover:shadow-sm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Users size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Team access</span>
            <span className="block text-xs text-muted-foreground">
              Add people by email and choose exactly what each one can see. This is where the cold caller gets set up.
            </span>
          </span>
          <span className="text-xs font-semibold text-primary group-hover:underline">Manage</span>
        </Link>
      )}

      <EmailSnippets />
    </div>
  );
}
