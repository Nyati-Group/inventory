"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/form";
import { EmptyState } from "./ui/misc";
import { cn, toCsv } from "@/lib/utils";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  toolbar?: React.ReactNode;
  csvName?: string;
  /** Map a row to CSV fields (defaults to accessor values). */
  csvRow?: (row: T) => Record<string, unknown>;
  rowClassName?: (row: T) => string | undefined;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  pageSize?: number;
  initialSorting?: SortingState;
  initialHidden?: VisibilityState;
}

export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = "Search…",
  filters,
  toolbar,
  csvName,
  csvRow,
  rowClassName,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  pageSize = 15,
  initialSorting = [],
  initialHidden = {},
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [visibility, setVisibility] = React.useState<VisibilityState>(initialHidden);
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const exportCsv = () => {
    const rows = table.getFilteredRowModel().rows.map((r) => {
      if (csvRow) return csvRow(r.original);
      const out: Record<string, unknown> = {};
      for (const c of r.getVisibleCells()) {
        const h = c.column.columnDef.header;
        if (typeof h === "string" && h) out[h] = c.getValue();
      }
      return out;
    });
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName ?? "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: ps } = table.getState().pagination;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="Search table" />
        </div>
        {filters}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <DM.Root>
            <DM.Trigger asChild>
              <Button variant="secondary" size="sm" aria-label="Choose columns">
                <Columns3 className="h-4 w-4" /> Columns
              </Button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" className="z-50 min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-lg">
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide() && typeof c.columnDef.header === "string" && c.columnDef.header)
                  .map((c) => (
                    <DM.CheckboxItem
                      key={c.id}
                      checked={c.getIsVisible()}
                      onCheckedChange={(v) => c.toggleVisibility(!!v)}
                      onSelect={(e) => e.preventDefault()}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-brand-100"
                    >
                      <span className={cn("h-3.5 w-3.5 rounded border", c.getIsVisible() ? "border-brand-600 bg-brand-600" : "border-border")} />
                      {c.columnDef.header as string}
                    </DM.CheckboxItem>
                  ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!total}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>
      <div className="scrollbar-thin max-h-[65vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} className="th" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
                      {h.isPlaceholder ? null : sortable ? (
                        <button className="inline-flex items-center gap-1 uppercase" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="h-3 w-3" /> : dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-slate-50", rowClassName?.(r.original))}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="td">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState title={globalFilter ? "No matching rows" : emptyTitle} description={globalFilter ? "Try a different search." : emptyDescription} action={globalFilter ? undefined : emptyAction} />}
      </div>
      {total > ps && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
          <span>
            {pageIndex * ps + 1}–{Math.min((pageIndex + 1) * ps, total)} of {total}
          </span>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="card space-y-2 p-4">
      <div className="h-8 w-64 animate-pulse rounded bg-slate-200/70" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}
