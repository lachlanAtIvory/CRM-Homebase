"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const RANGES = ["Day", "Week", "Month", "Quarter", "H1", "All-Time"] as const;
type Range = (typeof RANGES)[number];

export function ClosedDealsWidget() {
  const [range, setRange] = useState<Range>("Month");

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
          <p className="text-6xl font-bold tracking-tight">0</p>
          <p className="mt-2 text-sm text-muted-foreground">
            deals closed · {range}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
