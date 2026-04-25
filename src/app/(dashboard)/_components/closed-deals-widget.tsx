"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const RANGES = ["Day", "Week", "Month", "Quarter", "H1", "All-Time"] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  "Day":       1,
  "Week":      7,
  "Month":     30,
  "Quarter":   90,
  "H1":        180,
  "All-Time":  0,   // 0 means no date filter
};

export function ClosedDealsWidget() {
  const [range, setRange]   = useState<Range>("Month");
  const [count, setCount]   = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      setLoading(true);
      const supabase = createClient();

      // Count rows in stage_history where a deal transitioned TO live_client
      let query = supabase
        .from("stage_history")
        .select("id", { count: "exact", head: true })
        .eq("to_stage", "live_client");

      const days = RANGE_DAYS[range];
      if (days > 0) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("changed_at", since);
      }

      const { count: total } = await query;
      if (!cancelled) {
        setCount(total ?? 0);
        setLoading(false);
      }
    }

    fetchCount();
    return () => { cancelled = true; };
  }, [range]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Closed Deals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                r === range
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="py-6 text-center">
          <p
            className={cn(
              "text-6xl font-bold tracking-tight transition-opacity",
              loading && "opacity-30",
            )}
          >
            {count}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            deals reached Live Client · {range}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
