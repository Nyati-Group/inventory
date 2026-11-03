import * as React from "react";
import { Check, Star, Inbox } from "lucide-react";
import { cn, titleCase } from "@/lib/utils";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-100 text-brand-600 ring-brand-100",
  success: "bg-green-50 text-green-700 ring-green-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  QUEUED: "neutral",
  SENT: "brand",
  OPENED: "brand",
  PARTIALLY_RESPONDED: "warning",
  RESPONDED: "success",
  CLOSED: "neutral",
  AWAITING_APPROVAL: "warning",
  APPROVED: "success",
  ORDERED: "success",
  CANCELLED: "danger",
  DECLINED: "danger",
  NO_RESPONSE: "neutral",
  FAILED: "danger",
  PENDING: "warning",
  REJECTED: "danger",
  RE_RFQ: "warning",
  ACCEPTED: "success",
  CHANGE_REQUESTED: "warning",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  PARSED: "success",
  NEEDS_REVIEW: "warning",
  CONFIRMED: "success",
  ACTIVE: "success",
  ON_HOLD: "warning",
  BLACKLISTED: "danger",
  DEMO: "brand",
  OPEN: "warning",
  RFQ_CREATED: "brand",
  PLANNING: "neutral",
  COMPLETED: "neutral",
  DISPATCHED: "brand",
  IN_TRANSIT: "brand",
  DELAYED: "danger",
  ARRIVED: "success",
  REPLACED: "success",
  CREDITED: "success",
};

const STATUS_LABEL: Record<string, string> = { RFQ_CREATED: "RFQ created", RE_RFQ: "Re-RFQ", DEMO: "Demo outbox" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? titleCase(status)}</Badge>;
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          {typeof title === "string" ? <h2 className="text-sm font-semibold">{title}</h2> : title}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold text-brand-800", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="rounded-full bg-brand-100 p-3 text-brand-600">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <div className="font-semibold text-brand-800">{title}</div>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stars({ value, size = 14, showValue = true }: { value: number | null; size?: number; showValue?: boolean }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted">No rating</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, value - (i - 1)));
          return (
            <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
              <Star className="absolute inset-0 text-slate-300" style={{ width: size, height: size }} />
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="fill-amber-400 text-amber-400" style={{ width: size, height: size }} />
              </span>
            </span>
          );
        })}
      </span>
      {showValue && <span className="text-xs font-semibold text-brand-800">{value.toFixed(1)}</span>}
    </span>
  );
}

export const ORDER_STEPS = ["RFQ", "Quotes", "Compare", "Approve", "PO", "Delivery", "GRN", "Rated"] as const;

/** Visual process stepper (§9). `current` is the index of the active stage. */
export function Stepper({ current, steps = ORDER_STEPS as readonly string[] }: { current: number; steps?: readonly string[] }) {
  return (
    <ol className="scrollbar-thin flex items-center gap-1 overflow-x-auto pb-1" aria-label="Process stage">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                done && "bg-brand-600 text-white",
                active && "bg-white text-brand-600 ring-2 ring-brand-600",
                !done && !active && "bg-slate-100 text-muted",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("whitespace-nowrap text-xs font-medium", active ? "text-brand-600" : done ? "text-brand-800" : "text-muted")}>{s}</span>
            {i < steps.length - 1 && <span className={cn("mx-1 h-px w-5 shrink-0", done ? "bg-brand-600" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

export function PageHeader({ title, description, actions, crumbs }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {crumbs}
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ScoreBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "success" | "warning" | "danger" }) {
  const color = { brand: "bg-brand-600", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-slate-100" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-2 rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
