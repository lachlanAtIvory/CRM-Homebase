import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GuruWidget } from "@/components/guru/guru-widget";
import { TaskReminderManager } from "./_components/task-reminder-manager";
import { can, NAV_NEED } from "@/lib/hq/access";
import { ensureFounderRecord, resolveAccess } from "@/lib/hq/access-server";
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
  // this works out what the person who IS here gets to see.
  const result = await resolveAccess(supabase, user?.email);
  if (!result.ok) redirect("/login");
  const access = result.access;

  // The database lock recognises managers by a row in team_members, so make
  // sure each founder has one. Bookkeeping only: never block the page on it.
  if (access.source === "env") {
    try { await ensureFounderRecord(adminClient(), access); } catch { /* ignore */ }
  }

  const email = user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? null;
  const visibleLinks = Object.keys(NAV_NEED).filter((href) => can(access, NAV_NEED[href]));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar visible={visibleLinks} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header email={email} avatarUrl={avatarUrl} canLaunchApplication={can(access, "applications")} />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-6">
          {children}
        </main>
      </div>

      {/* Background — polls open tasks, fires reminders 10 min before due time.
          Tasks are shared, so only people with the Tasks section get them. */}
      {can(access, "tasks") && <TaskReminderManager />}

      {/* Floating "Ask the Guru" sales-trainer chat, bottom-right on every page.
          It's built on the full Sales Bible (pricing, strategy), so managers only. */}
      {can(access, "manager") && <GuruWidget />}
    </div>
  );
}
