"use client";

import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip } from "recharts";
import { ScoreBar } from "./ui/misc";
import { BRAND } from "@/lib/chart-colors";
import { fmtDate } from "@/lib/utils";

export const POINTER_LABELS: Record<string, string> = {
  PRICE: "Price competitiveness",
  DELIVERY: "Delivery timeliness",
  QUALITY: "Quality & quantity accuracy",
  RESPONSIVENESS: "Responsiveness & communication",
  COMPLIANCE: "Commercial & documentation",
};
export const POINTER_ORDER = ["PRICE", "DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE"];

/** One bar per pointer (0–100, shown as stars). */
export function RatingBreakdown({ criteria }: { criteria: { key: string; score: number; weight?: number }[] }) {
  const sorted = POINTER_ORDER.map((k) => criteria.find((c) => c.key === k)).filter(Boolean) as { key: string; score: number; weight?: number }[];
  return (
    <div className="space-y-2">
      {sorted.map((c) => (
        <div key={c.key}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="text-brand-800">{POINTER_LABELS[c.key]}{c.weight ? <span className="text-muted"> · {c.weight}%</span> : null}</span>
            <span className="font-semibold tabular-nums">{(c.score / 20).toFixed(1)}★</span>
          </div>
          <ScoreBar value={c.score} tone={c.score >= 80 ? "success" : c.score >= 60 ? "brand" : c.score >= 45 ? "warning" : "danger"} />
        </div>
      ))}
    </div>
  );
}

/** Trend sparkline of order ratings (oldest → newest). */
export function RatingSparkline({ points, height = 36 }: { points: { date: string; stars: number }[]; height?: number }) {
  if (points.length < 2) return <span className="text-xs text-muted">Not enough orders</span>;
  return (
    <div style={{ height, width: 120 }} aria-label={`Rating trend: ${points.map((p) => p.stars.toFixed(1)).join(", ")}`}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis domain={[0, 5]} hide />
          <Tooltip formatter={(v: number) => [`${v.toFixed(2)}★`, "Rating"]} labelFormatter={(_, p) => (p?.[0] ? fmtDate((p[0].payload as { date: string }).date) : "")} />
          <Line dataKey="stars" stroke={BRAND.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
