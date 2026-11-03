import { TableSkeleton } from "@/components/data-table";
import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px]" />
        ))}
      </div>
      <TableSkeleton rows={12} />
    </div>
  );
}
