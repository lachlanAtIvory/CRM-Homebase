import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Hotel, MessageCircle, AlertCircle, TrendingUp, ExternalLink } from "lucide-react";
import Link from "next/link";

/**
 * Per-hotel Concierge usage dashboard.
 *
 * Computes for each hotel:
 *   - Today's conversations + % of daily cap used
 *   - This month's conversations + % of monthly cap used
 *   - Estimated $ cost so far (based on per-message averages)
 *   - Most common questions today (top 5)
 *   - Top question categories
 *
 * Read-only. Used to monitor costs + decide when to raise/lower caps per hotel.
 */
export default async function ConciergeUsagePage() {
  const supabase = await createClient();
  const todayStart = startOfDayAU();
  const monthStart = startOfMonthAU();

  // ── Fetch all the data in parallel ────────────────────────────────────────
  const [
    { data: hotels },
    { data: monthMessages },
    { data: todayMessages },
  ] = await Promise.all([
    supabase
      .from("concierge_hotels")
      .select("id, slug, name, is_active, daily_conv_cap, monthly_conv_cap")
      .order("created_at", { ascending: true }),
    // All user messages this month — used for monthly counts + recent activity
    supabase
      .from("concierge_messages")
      .select("session_id, content, created_at")
      .eq("role", "user")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false })
      .limit(5000),
    // Today's user messages — used for daily counts + top questions
    supabase
      .from("concierge_messages")
      .select("session_id, content")
      .eq("role", "user")
      .gte("created_at", todayStart)
      .limit(5000),
  ]);

  // Build sessionId → hotelId lookup so we can attribute messages
  const sessionIds = Array.from(new Set([
    ...(monthMessages ?? []).map((m) => m.session_id as string),
    ...(todayMessages ?? []).map((m) => m.session_id as string),
  ]));
  const sessionToHotel = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from("concierge_sessions")
      .select("id, hotel_id")
      .in("id", sessionIds);
    for (const s of sessions ?? []) {
      sessionToHotel.set(s.id as string, s.hotel_id as string);
    }
  }

  // ── Aggregate per-hotel ────────────────────────────────────────────────
  const hotelStats = (hotels ?? []).map((h) => {
    const hotelId = h.id as string;
    const todayCount = (todayMessages ?? []).filter(
      (m) => sessionToHotel.get(m.session_id as string) === hotelId,
    ).length;
    const monthCount = (monthMessages ?? []).filter(
      (m) => sessionToHotel.get(m.session_id as string) === hotelId,
    ).length;
    const topQuestions = topNQuestions(
      (todayMessages ?? []).filter(
        (m) => sessionToHotel.get(m.session_id as string) === hotelId,
      ).map((m) => m.content as string),
    );
    const dailyCap   = (h.daily_conv_cap   as number) || 200;
    const monthlyCap = (h.monthly_conv_cap as number) || 1000;
    return {
      ...h,
      todayCount,
      monthCount,
      topQuestions,
      dailyCap,
      monthlyCap,
      dailyPct:   Math.min(100, Math.round((todayCount / dailyCap)   * 100)),
      monthlyPct: Math.min(100, Math.round((monthCount / monthlyCap) * 100)),
      // ~$0.001 input + $0.001 output (Haiku 4.5 with caching) per message
      // = ~$0.002. Voice adds ~$0.015/msg but only ~30% turn it on.
      estCostUsd: ((monthCount * 0.002) + (monthCount * 0.3 * 0.015)).toFixed(2),
    };
  });

  const totals = {
    today:  hotelStats.reduce((s, h) => s + h.todayCount, 0),
    month:  hotelStats.reduce((s, h) => s + h.monthCount, 0),
    cost:   hotelStats.reduce((s, h) => s + parseFloat(h.estCostUsd), 0).toFixed(2),
    active: hotelStats.filter((h) => h.is_active).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Concierge Usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-hotel conversation counts, caps, and estimated AI costs. Updates live as guests chat.
        </p>
      </div>

      {/* ── Totals row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatBlock
          icon={<Hotel size={16} />}
          label="Active hotels"
          value={totals.active.toString()}
          tone="neutral"
        />
        <StatBlock
          icon={<MessageCircle size={16} />}
          label="Conversations today"
          value={totals.today.toLocaleString("en-AU")}
          tone="primary"
        />
        <StatBlock
          icon={<TrendingUp size={16} />}
          label="Conversations this month"
          value={totals.month.toLocaleString("en-AU")}
          tone="primary"
        />
        <StatBlock
          icon={<AlertCircle size={16} />}
          label="Estimated cost this month"
          value={`$${totals.cost} USD`}
          tone="success"
        />
      </div>

      {/* ── Per-hotel cards ────────────────────────────────────────────────── */}
      {hotelStats.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center ring-1 ring-foreground/5">
          <Hotel size={32} className="mx-auto opacity-30" />
          <h2 className="mt-3 text-sm font-semibold">No hotels yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Seed a hotel in the concierge_hotels table to see usage here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {hotelStats.map((h) => (
            <div
              key={h.id as string}
              className={cn(
                "rounded-xl border bg-card p-5 ring-1 ring-foreground/5 transition-all",
                !h.is_active && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{h.name as string}</h3>
                    {!h.is_active && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    /{h.slug as string}
                  </p>
                </div>
                <Link
                  href={`/concierge/${h.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40"
                >
                  Open chat
                  <ExternalLink size={11} />
                </Link>
              </div>

              {/* Caps progress bars */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <CapBar
                  label="Daily"
                  used={h.todayCount}
                  cap={h.dailyCap}
                  pct={h.dailyPct}
                />
                <CapBar
                  label="Monthly"
                  used={h.monthCount}
                  cap={h.monthlyCap}
                  pct={h.monthlyPct}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  Estimated cost this month:{" "}
                  <span className="font-semibold text-foreground">${h.estCostUsd} USD</span>
                </span>
                {h.topQuestions.length > 0 && (
                  <span className="text-muted-foreground">
                    Top question today:{" "}
                    <span className="text-foreground">&ldquo;{h.topQuestions[0]?.q}&rdquo;</span>
                  </span>
                )}
              </div>

              {/* Top questions list (collapsible) */}
              {h.topQuestions.length > 1 && (
                <details className="mt-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Top questions today ({h.topQuestions.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {h.topQuestions.map((q, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{q.q}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">×{q.count}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function StatBlock({
  icon, label, value, tone,
}: {
  icon:  React.ReactNode;
  label: string;
  value: string;
  tone:  "neutral" | "primary" | "success";
}) {
  const toneClass = {
    neutral: "text-muted-foreground",
    primary: "text-primary",
    success: "text-emerald-600",
  }[tone];
  return (
    <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/5">
      <div className={cn("flex items-center gap-2 text-xs font-medium uppercase tracking-wide", toneClass)}>
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold leading-none tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function CapBar({
  label, used, cap, pct,
}: {
  label: string; used: number; cap: number; pct: number;
}) {
  const warn   = pct >= 80;
  const danger = pct >= 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={cn(
          "font-mono tabular-nums",
          danger ? "font-bold text-destructive"
          : warn ? "font-semibold text-amber-600"
                 : "text-muted-foreground",
        )}>
          {used.toLocaleString("en-AU")} / {cap.toLocaleString("en-AU")}
          <span className="ml-1.5 opacity-70">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            danger ? "bg-destructive"
            : warn ? "bg-amber-500"
                   : "bg-primary",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function topNQuestions(qs: string[], n = 5): { q: string; count: number }[] {
  // Normalize to catch duplicates ("What time is checkout?" === "what time is checkout")
  const normalised = qs.map((q) => q.trim().toLowerCase().replace(/[?.!]+$/, ""));
  const counts = new Map<string, number>();
  for (const q of normalised) counts.set(q, (counts.get(q) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([q, count]) => ({
      q: q.charAt(0).toUpperCase() + q.slice(1) + (qs.find((x) => x.trim().toLowerCase().startsWith(q))?.match(/[?.!]/) ? "?" : ""),
      count,
    }));
}

function startOfDayAU(): string {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return `${d}T00:00:00+00:00`;
}

function startOfMonthAU(): string {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit",
  }).format(new Date());
  const [y, m] = d.split("-");
  return `${y}-${m}-01T00:00:00+00:00`;
}
