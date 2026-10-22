import Link from "next/link";
import { getEffectiveAccess } from "@/lib/hq/access-guard";
import { can } from "@/lib/hq/access";
import { CalendarClock, PhoneCall, Users } from "lucide-react";
import { EmailSnippets } from "./email-snippets";

export default async function SettingsPage() {
  const access = await getEffectiveAccess();
  const isManager = !!access && can(access, "manager");

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

      {isManager && (
        <Link
          href="/settings/availability"
          className="group flex items-center gap-4 rounded-xl border bg-card p-5 ring-1 ring-foreground/5 transition-all hover:border-primary/50 hover:shadow-sm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <CalendarClock size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Call availability</span>
            <span className="block text-xs text-muted-foreground">
              Set the hours you and Ryan take sales calls, and add time off. The caller can only book from these times.
            </span>
          </span>
          <span className="text-xs font-semibold text-primary group-hover:underline">Manage</span>
        </Link>
      )}

      {isManager && (
        <Link
          href="/settings/dialsheet"
          className="group flex items-center gap-4 rounded-xl border bg-card p-5 ring-1 ring-foreground/5 transition-all hover:border-primary/50 hover:shadow-sm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <PhoneCall size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">DialSheet</span>
            <span className="block text-xs text-muted-foreground">
              Every call Jan makes in DialSheet is logged on its lead here. Check the connection and see what DialSheet has sent.
            </span>
          </span>
          <span className="text-xs font-semibold text-primary group-hover:underline">Manage</span>
        </Link>
      )}

      <EmailSnippets />
    </div>
  );
}
