import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GuruWidget } from "@/components/guru/guru-widget";
import { TaskReminderManager } from "./_components/task-reminder-manager";
import { CallbackReminders } from "./_components/callback-reminders";
import { PreviewBanner } from "./_components/preview-banner";
import { can, NAV_NEED, PREVIEW_COOKIE } from "@/lib/hq/access";
import { ensureFounderRecord, resolveAccessView } from "@/lib/hq/access-server";
import { adminClient } from "@/lib/hq/supabase-admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware has already turned away anyone who shouldn't be here;
  // this works out what the person who IS here gets to see. A manager who is
  // previewing as someone gets that person's view (and a banner saying so).
  const preview = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const result = await resolveAccessView(supabase, user?.email, preview);
  if (!result.ok) redirect("/login");
  const { real, effective: access, previewing } = result.view;

  // The database lock recognises managers by a row in team_members, so make
  // sure each founder has one. Bookkeeping only: never block the page on it.
  if (real.source === "env") {
    try { await ensureFounderRecord(adminClient(), real); } catch { /* ignore */ }
  }

  const email = user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? null;
  const visibleLinks = Object.keys(NAV_NEED).filter((href) => can(access, NAV_NEED[href]));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {previewing && <PreviewBanner name={previewing.name} email={previewing.email} />}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar visible={visibleLinks} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header email={email} avatarUrl={avatarUrl} canLaunchApplication={can(access, "applications")} />
          <main className="flex-1 overflow-y-auto bg-muted/20 p-6">
            {children}
          </main>
        </div>
      </div>

      {/* Background — polls open tasks, fires reminders 10 min before due time.
          Only people with the Tasks section get them. */}
      {can(access, "tasks") && <TaskReminderManager />}

      {/* Callback reminders: a heads-up, a "due now" and overdue nudges for the callbacks
          this person promised, wherever they are in the CRM. */}
      {can(access, "call-list") && <CallbackReminders />}

      {/* Floating "Ask the Guru" sales-trainer chat, bottom-right on every page.
          It's built on the full Sales Bible (pricing, strategy), so managers only. */}
      {can(access, "manager") && <GuruWidget />}
    </div>
  );
}
