"use client";

import { BRAND } from "@/lib/chart-colors";

/** Split a label into at most `maxLines` lines of roughly `maxChars`, ending with "…" if it doesn't fit. */
export function wrapLabel(label: string, maxChars: number, maxLines = 2): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(" ").length;
  const truncated = used < label.replace(/\s+/g, " ").trim().length;
  return lines.slice(0, maxLines).map((l, i, arr) => {
    const last = i === arr.length - 1;
    if (l.length > maxChars) return `${l.slice(0, Math.max(1, maxChars - 1))}…`;
    if (!last || !truncated) return l;
    return l.length < maxChars ? `${l}…` : `${l.slice(0, Math.max(1, maxChars - 1))}…`;
  });
}

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value: string };
  /** Width available per category (set from the chart width / number of bars). */
  width?: number;
  visibleTicksCount?: number;
};

/**
 * Recharts X-axis tick that wraps long category names (e.g. vendor names) onto two lines and shortens them to
 * the space each bar has, so neighbouring labels never overlap. Full name is shown on hover.
 */
export function WrappedTick({ x = 0, y = 0, payload, width = 300, visibleTicksCount = 1 }: TickProps) {
  const label = String(payload?.value ?? "");
  const band = width / Math.max(1, visibleTicksCount);
  const maxChars = Math.max(4, Math.floor((band - 8) / 6.2)); // ~6.2px per char at 11px
  const lines = wrapLabel(label, maxChars);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{label}</title>
      <text textAnchor="middle" fontSize={11} fill={BRAND.muted}>
        {lines.map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? 12 : 13}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}
