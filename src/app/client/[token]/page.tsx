import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import {
  fetchPortalStats, formatDuration, formatOutcomeLabel, formatRelativeSydney,
  type PortalDays,
} from "@/lib/hq/client-portal";
import {
  CalendarCheck2, Lock, Mail, Moon, Phone,
} from "lucide-react";

/**
 * Client portal — public, token-gated performance report.
 *
 * No auth: the unguessable portal_token IS the access control (see the
 * migration + docs/client-portal.md). Never fetches or renders call
 * transcripts/summaries — only aggregate counts and a generic outcome
 * label + timestamp per recent call.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return {
    title: "Agent Ivory — Performance report",
    robots: { index: false, follow: false },
  };
}

const VALID_DAYS: PortalDays[] = [7, 30, 90];

export default async function ClientPortalPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { token } = await params;
  const { days: daysParam } = await searchParams;

  if (!token || token.length < 20) notFound();

  const days = (VALID_DAYS.includes(Number(daysParam) as PortalDays)
    ? Number(daysParam)
    : 30) as PortalDays;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: client } = await supabase
    .from("hq_clients")
    .select("id, name, status")
    .eq("portal_token", token)
    .maybeSingle();

  if (!client || client.status !== "active") notFound();

  const stats = await fetchPortalStats(supabase, client.id as string, client.name as string, days);
  const maxBucket = Math.max(1, ...stats.weeklyBuckets);

  return (
    <div className="min-h-screen bg-[#0d0b12] px-4 py-12 text-white sm:px-8">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#141018] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[linear-gradient(145deg,var(--brand),var(--brand-strong))] text-base font-medium text-white">
              I
            </div>
            <div>
              <div className="text-lg font-medium">{stats.clientName}</div>
              <div className="text-sm text-white/50">Performance overview</div>
            </div>
          </div>
          <div className="flex gap-1 rounded-full bg-white/5 p-1">
            {VALID_DAYS.map((d) => (
              <a
                key={d}
                href={`?days=${d}`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  d === days ? "bg-[var(--brand)] text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {d}d
              </a>
            ))}
          </div>
        </div>

        {/* Hero: bookings */}
        <div className="px-8 pb-2 pt-8">
          <div className="text-xs uppercase tracking-wide text-white/45">
            Bookings captured by Ivory
          </div>
          <div className="mt-2 text-7xl font-medium leading-none">{stats.bookings}</div>
          {stats.bookingsDeltaPct !== null && (
            <div className={`mt-3 text-sm ${stats.bookingsDeltaPct >= 0 ? "text-emerald-400" : "text-white/50"}`}>
              {stats.bookingsDeltaPct >= 0 ? "+" : ""}{stats.bookingsDeltaPct}% vs previous {days} days
            </div>
          )}
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3 px-8 py-7 sm:grid-cols-4">
          <StatBox icon={<Phone size={16} />} label="Calls handled" value={stats.totalCalls} />
          <StatBox icon={<Moon size={16} />} label="After-hours calls" value={stats.afterHours} />
          <StatBox icon={<Mail size={16} />} label="Messages taken" value={stats.messagesTaken} />
          <StatBox icon={<CalendarCheck2 size={16} />} label="Avg call length" value={formatDuration(stats.avgDurationSeconds)} />
        </div>

        {/* Trend */}
        <div className="px-8 pb-7">
          <div className="mb-3 text-xs text-white/45">Calls per period</div>
          <div className="flex h-20 items-end gap-2">
            {stats.weeklyBuckets.map((v, i) => {
              const isLast = i === stats.weeklyBuckets.length - 1;
              const pct = Math.max(6, Math.round((v / maxBucket) * 100));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-md ${isLast ? "bg-[linear-gradient(180deg,#8f7cf5,var(--brand))]" : "bg-[#3c3489]"}`}
                  style={{ height: `${pct}%` }}
                  title={`${v} calls`}
                />
              );
            })}
          </div>
        </div>

        {/* Recent activity */}
        <div className="border-t border-white/10 px-8 py-7">
          <div className="mb-3.5 text-xs text-white/45">Recent activity</div>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-white/40">No activity in this period yet.</p>
          ) : (
            <div className="space-y-3.5">
              {stats.recent.map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <OutcomeIcon outcome={item.outcome} />
                  <span className="text-white/80">
                    {formatOutcomeLabel(item.outcome)}{" "}
                    <span className="text-white/40">· {formatRelativeSydney(item.startedAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Privacy footer */}
        <div className="flex items-center gap-2.5 border-t border-white/10 bg-white/[0.03] px-8 py-4">
          <Lock size={15} className="shrink-0 text-white/40" />
          <p className="text-xs leading-relaxed text-white/40">
            Summary activity only. No call transcripts or caller details are ever shown on this page.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-white/45">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-medium">{value}</div>
    </div>
  );
}

function OutcomeIcon({ outcome }: { outcome: string }) {
  const cls = "mt-0.5 shrink-0";
  switch (outcome) {
    case "booked":        return <CalendarCheck2 size={14} className={`${cls} text-emerald-400`} />;
    case "message_taken": return <Mail size={14} className={`${cls} text-[#8f7cf5]`} />;
    default:               return <Phone size={14} className={`${cls} text-amber-400`} />;
  }
}
