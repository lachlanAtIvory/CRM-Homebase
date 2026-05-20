"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Activity, Users, Eye, Clock, MapPin, Smartphone, Globe, ArrowUpRight, Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
type Event = {
  id:         string;
  event_type: "pageview" | "heartbeat";
  session_id: string;
  visitor_id: string | null;
  path:       string | null;
  referrer:   string | null;
  country:    string | null;
  device:     string | null;
  browser:    string | null;
  os:         string | null;
  created_at: string;
};

// ─── Component ──────────────────────────────────────────────────────────────
export function AnalyticsDashboard({
  initialEvents,
  initialActiveCount,
}: {
  initialEvents:      Event[];
  initialActiveCount: number;
  serverNowIso:       string;
}) {
  const [events,      setEvents]      = useState<Event[]>(initialEvents);
  const [activeCount, setActiveCount] = useState<number>(initialActiveCount);
  const [feed,        setFeed]        = useState<Event[]>(
    initialEvents.filter((e) => e.event_type === "pageview").slice(0, 8),
  );
  const [pulseKey,    setPulseKey]    = useState(0); // bumps when active count changes — drives the pulse animation

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("analytics_events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "analytics_events" },
        (payload) => {
          const ev = payload.new as Event;
          setEvents((prev) => [ev, ...prev]);
          if (ev.event_type === "pageview") {
            setFeed((prev) => [ev, ...prev].slice(0, 8));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Recompute active count every 10s so visitors leaving (no heartbeat for
  //    5 min) actually disappear from the counter ─────────────────────────────
  useEffect(() => {
    function recompute() {
      const cutoff = Date.now() - 5 * 60 * 1000;
      const set = new Set<string>();
      for (const e of events) {
        if (new Date(e.created_at).getTime() >= cutoff) set.add(e.session_id);
      }
      setActiveCount((prev) => {
        if (prev !== set.size) setPulseKey((k) => k + 1);
        return set.size;
      });
    }
    recompute();
    const id = setInterval(recompute, 10000);
    return () => clearInterval(id);
  }, [events]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => computeStats(events), [events]);

  return (
    <div className="space-y-5">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            Website Analytics
            <Sparkles size={18} className="text-primary animate-pulse" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live data from agentivory.com — last 30 days
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          Updates in real time · {stats.lastUpdateLabel}
        </div>
      </div>

      {/* ─── Top stat row ─── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ActiveNowCard count={activeCount} pulseKey={pulseKey} />
        <StatCard
          icon={<Users size={16} />}
          label="Unique visitors today"
          value={stats.visitorsToday}
          delta={stats.visitorsTodayDeltaPct}
        />
        <StatCard
          icon={<Eye size={16} />}
          label="Pageviews today"
          value={stats.pageviewsToday}
          delta={stats.pageviewsTodayDeltaPct}
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Avg session"
          value={stats.avgSessionLabel}
          subValue="last 24h"
        />
      </div>

      {/* ─── Pageviews chart ─── */}
      <Card title="Pageviews — last 30 days" subtitle={`${stats.totalPageviews.toLocaleString("en-AU")} total · ${stats.totalVisitors.toLocaleString("en-AU")} unique visitors`}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.timeseries} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="aiv-views" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#6c4bf1" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#6c4bf1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color:           "var(--popover-foreground)",
                  border:          "1px solid var(--border)",
                  borderRadius:    8,
                  fontSize:        12,
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Area
                type="monotone"
                dataKey="pageviews"
                stroke="#6c4bf1"
                strokeWidth={2}
                fill="url(#aiv-views)"
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ─── Two-col: top pages + top referrers ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Top pages" subtitle="Most-viewed paths">
          <ListBars rows={stats.topPages} emptyText="No pageviews yet" />
        </Card>
        <Card title="Top referrers" subtitle="Where traffic comes from">
          <ListBars rows={stats.topReferrers} emptyText="No referrers yet" />
        </Card>
      </div>

      {/* ─── Three-col: devices + countries + live feed ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Devices" subtitle="How visitors are browsing">
          <DeviceDonut rows={stats.devices} />
        </Card>
        <Card title="Top countries" icon={<Globe size={14} />}>
          <ListBars rows={stats.countries} emptyText="No data yet" formatLabel={countryFlag} />
        </Card>
        <Card title="Live activity" icon={<Activity size={14} className="text-emerald-500" />}>
          <LiveFeed events={feed} />
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function ActiveNowCard({ count, pulseKey }: { count: number; pulseKey: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 ring-1 ring-foreground/5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        Active right now
      </div>
      <div
        key={pulseKey}
        className="mt-3 text-4xl font-bold leading-none tracking-tight tabular-nums animate-in zoom-in-95 duration-300"
      >
        {count.toLocaleString("en-AU")}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {count === 1 ? "person on the site" : "people on the site"}
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, delta, subValue,
}: {
  icon:     React.ReactNode;
  label:    string;
  value:    string | number;
  delta?:   number | null;
  subValue?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/5 transition-all duration-150 hover:shadow-md hover:shadow-primary/5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <CountUp value={value} className="text-3xl font-bold leading-none tracking-tight tabular-nums" />
        {typeof delta === "number" && !Number.isNaN(delta) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              delta >= 0 ? "text-emerald-600" : "text-destructive",
            )}
          >
            <ArrowUpRight size={12} className={cn(delta < 0 && "rotate-90")} />
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      {subValue && <div className="mt-1.5 text-xs text-muted-foreground">{subValue}</div>}
    </div>
  );
}

function Card({
  title, subtitle, icon, children,
}: {
  title:     string;
  subtitle?: string;
  icon?:     React.ReactNode;
  children:  React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 ring-1 ring-foreground/5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function ListBars({
  rows, emptyText, formatLabel,
}: {
  rows: { label: string; count: number }[];
  emptyText: string;
  formatLabel?: (label: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 8).map((r, i) => {
        const pct = (r.count / max) * 100;
        return (
          <div key={i} className="relative">
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-primary/10 transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
            <div className="relative flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
              <span className="min-w-0 truncate">{formatLabel ? formatLabel(r.label) : r.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{r.count.toLocaleString("en-AU")}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DEVICE_COLORS: Record<string, string> = {
  desktop: "#6c4bf1",
  mobile:  "#22c55e",
  tablet:  "#f59e0b",
};

function DeviceDonut({ rows }: { rows: { label: string; count: number }[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No data yet</p>;
  }
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="h-32 w-32 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="count"
              nameKey="label"
              innerRadius={36}
              outerRadius={56}
              stroke="var(--card)"
              strokeWidth={2}
              animationDuration={900}
            >
              {rows.map((r, i) => (
                <Cell key={i} fill={DEVICE_COLORS[r.label] ?? "#9ca3af"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 text-xs">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <div key={r.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 capitalize">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: DEVICE_COLORS[r.label] ?? "#9ca3af" }}
                />
                {r.label === "mobile" ? <Smartphone size={11} /> : null}
                {r.label}
              </span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveFeed({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Waiting for the first visit…</p>;
  }
  return (
    <div className="space-y-1.5">
      {events.map((e) => (
        <div
          key={e.id}
          className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-300"
        >
          <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-medium">{e.country ? countryFlag(e.country) : "🌐"}</span>
              <span className="truncate text-muted-foreground">{e.path || "/"}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              <RelTime iso={e.created_at} /> · {e.device ?? "—"} · {e.browser ?? "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RelTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => formatRel(iso));
  useEffect(() => {
    const id = setInterval(() => setLabel(formatRel(iso)), 5000);
    return () => clearInterval(id);
  }, [iso]);
  return <span>{label}</span>;
}

function formatRel(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5)    return "just now";
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return code ?? "—";
  const cp = [...code.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp) + " " + code.toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// Number that counts up smoothly when its value changes (the "dopamine" hit)
// ═══════════════════════════════════════════════════════════════════════════
function CountUp({ value, className }: { value: string | number; className?: string }) {
  const numeric = typeof value === "number" ? value : null;
  const [shown, setShown] = useState<number | string>(numeric ?? value);
  const fromRef = useRef<number>(numeric ?? 0);
  const targetRef = useRef<number>(numeric ?? 0);

  useEffect(() => {
    if (numeric === null) { setShown(value); return; }
    const from   = fromRef.current;
    const target = numeric;
    targetRef.current = target;
    if (from === target) return;

    const duration = 700;
    const start    = performance.now();
    let raf = 0;

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setShown(Math.round(v));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric, value]);

  return <span className={className}>{typeof shown === "number" ? shown.toLocaleString("en-AU") : shown}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure aggregation — all dashboard numbers derived from the events array
// ═══════════════════════════════════════════════════════════════════════════
function computeStats(events: Event[]) {
  const now      = Date.now();
  const dayMs    = 24 * 60 * 60 * 1000;
  const todayMs  = now - dayMs;
  const ydayMs   = now - 2 * dayMs;

  const pageviews = events.filter((e) => e.event_type === "pageview");
  const heartbeats = events.filter((e) => e.event_type === "heartbeat");

  // Today vs yesterday for delta arrows
  const pvToday    = pageviews.filter((e) => new Date(e.created_at).getTime() >= todayMs).length;
  const pvYday     = pageviews.filter((e) => {
    const t = new Date(e.created_at).getTime();
    return t < todayMs && t >= ydayMs;
  }).length;

  const visitorsTodaySet = new Set<string>();
  const visitorsYdaySet  = new Set<string>();
  for (const e of pageviews) {
    const t = new Date(e.created_at).getTime();
    if (t >= todayMs) visitorsTodaySet.add(e.visitor_id ?? e.session_id);
    else if (t >= ydayMs) visitorsYdaySet.add(e.visitor_id ?? e.session_id);
  }
  const visitorsToday = visitorsTodaySet.size;
  const visitorsYday  = visitorsYdaySet.size;

  // 30-day timeseries (pageviews per day)
  const buckets = new Map<string, { label: string; pageviews: number; visitors: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Sydney" });
    buckets.set(key, { label, pageviews: 0, visitors: 0 });
  }
  const seenPerDay = new Map<string, Set<string>>();
  for (const e of pageviews) {
    const key = (e.created_at as string).split("T")[0];
    const b = buckets.get(key);
    if (b) {
      b.pageviews++;
      let seen = seenPerDay.get(key);
      if (!seen) { seen = new Set(); seenPerDay.set(key, seen); }
      seen.add(e.visitor_id ?? e.session_id);
    }
  }
  for (const [key, set] of seenPerDay) {
    const b = buckets.get(key);
    if (b) b.visitors = set.size;
  }

  // Avg session duration (last 24h) — for each session in the window, take
  // (max(heartbeat or pageview ts) - min(pageview ts))
  const sessionStarts = new Map<string, number>();
  const sessionEnds   = new Map<string, number>();
  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    if (t < todayMs) continue;
    const cur = sessionStarts.get(e.session_id);
    if (cur === undefined || t < cur) sessionStarts.set(e.session_id, t);
    const end = sessionEnds.get(e.session_id);
    if (end === undefined || t > end) sessionEnds.set(e.session_id, t);
  }
  let totalSec  = 0;
  let countSess = 0;
  for (const [sid, start] of sessionStarts) {
    const end = sessionEnds.get(sid) ?? start;
    const sec = Math.max(0, Math.round((end - start) / 1000));
    totalSec  += sec;
    countSess++;
  }
  const avgSec = countSess > 0 ? Math.round(totalSec / countSess) : 0;

  // Top pages / referrers / countries / devices
  const topPages     = topN(pageviews, (e) => normalisePath(e.path));
  const topReferrers = topN(pageviews.filter((e) => e.referrer), (e) => normaliseReferrer(e.referrer ?? ""));
  const countries    = topN(pageviews.filter((e) => e.country), (e) => e.country ?? "");
  const devices      = topN(pageviews.filter((e) => e.device), (e) => e.device ?? "");

  return {
    visitorsToday,
    visitorsTodayDeltaPct: visitorsYday > 0 ? ((visitorsToday - visitorsYday) / visitorsYday) * 100 : null,
    pageviewsToday: pvToday,
    pageviewsTodayDeltaPct: pvYday > 0 ? ((pvToday - pvYday) / pvYday) * 100 : null,
    avgSessionLabel: formatDuration(avgSec),
    totalPageviews: pageviews.length,
    totalVisitors:  new Set(pageviews.map((e) => e.visitor_id ?? e.session_id)).size,
    timeseries: Array.from(buckets.values()),
    topPages,
    topReferrers,
    countries,
    devices,
    lastUpdateLabel: heartbeats.length === 0 && pageviews.length === 0
      ? "no events yet"
      : "live",
  };
}

function topN(events: Event[], key: (e: Event) => string): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of events) {
    const k = key(e);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function normalisePath(p: string | null): string {
  if (!p) return "/";
  return p.replace(/\?.*$/, "") || "/";
}

function normaliseReferrer(r: string): string {
  try {
    const u = new URL(r);
    return u.hostname.replace(/^www\./, "");
  } catch { return r; }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
