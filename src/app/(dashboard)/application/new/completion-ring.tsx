"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/**
 * SVG progress ring — colour-shifts as the percent goes up.
 *   < 40%  → red       (lots missing)
 *   40-70% → amber     (getting there)
 *   70-99% → primary   (almost)
 *   100%   → emerald   (done) + check icon in centre
 */
export function CompletionRing({
  percent,
  size = 56,
  stroke = 5,
  label,
}: {
  percent: number;
  size?:   number;
  stroke?: number;
  label?:  string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius        = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset        = circumference - (clamped / 100) * circumference;

  const colorClass =
    clamped === 100 ? "text-emerald-500"
    : clamped >= 70 ? "text-primary"
    : clamped >= 40 ? "text-amber-500"
                    : "text-destructive";

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-foreground/10"
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-500 ease-out", colorClass)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {clamped === 100 ? (
          <Check size={size * 0.42} className="text-emerald-500 animate-in zoom-in-50 duration-300" />
        ) : (
          <>
            <span className={cn("text-sm font-bold leading-none tabular-nums", colorClass)}>
              {clamped}
            </span>
            {size >= 56 && (
              <span className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">
                {label ?? "%"}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
