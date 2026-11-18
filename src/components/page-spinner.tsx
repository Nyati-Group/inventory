import { EMBLEM_SRC } from "@/components/logo";

/** Round loading spinner (NYATI emblem inside a spinning ring), centred in the content area. */
export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="relative h-16 w-16">
        <span className="absolute inset-0 rounded-full border-4 border-brand-100" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-brand-600 border-r-brand-600" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={EMBLEM_SRC} alt="" width={36} height={36} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      </div>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}
