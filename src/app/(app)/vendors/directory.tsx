"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { Badge, Stars, StatusBadge } from "@/components/ui/misc";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VendorForm } from "@/components/vendor-form";

type Row = {
  id: string;
  name: string;
  contact: string | null;
  email: string;
  phone: string | null;
  city: string;
  gstin: string | null;
  categories: string[];
  categoryIds: string[];
  rating: number | null;
  completedOrders: number;
  grade: string;
  status: string;
  projects: number;
  preferred: boolean;
};

export function VendorDirectory({ rows, categories, materials, canEdit }: { rows: Row[]; categories: { id: string; name: string }[]; materials: { id: string; name: string; categoryId: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [cat, setCat] = React.useState("");
  const [city, setCity] = React.useState("");
  const [minRating, setMinRating] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const cities = [...new Set(rows.map((r) => r.city))].sort();
  const data = rows.filter(
    (r) => (!cat || r.categoryIds.includes(cat)) && (!city || r.city === city) && (!minRating || (r.rating ?? 0) >= Number(minRating)) && (!status || r.status === status),
  );
  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "name",
      header: "Vendor",
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[200px]">
          <Link href={`/vendors/${r.id}`} className="link">{r.name}</Link>
          <div className="text-xs text-muted">{r.contact} · {r.email}</div>
        </div>
      ),
    },
    { accessorKey: "city", header: "City" },
    { id: "categories", header: "Categories", accessorFn: (r) => r.categories.join(", "), cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> },
    { accessorKey: "rating", header: "Rating", sortingFn: (a, b) => (a.original.rating ?? 0) - (b.original.rating ?? 0), cell: ({ row: { original: r } }) => (r.completedOrders < 3 ? <Badge>New</Badge> : <Stars value={r.rating} />) },
    { accessorKey: "grade", header: "Grade", cell: ({ getValue }) => <span className="text-xs font-medium">{getValue() as string}</span> },
    { accessorKey: "completedOrders", header: "Orders" },
    { accessorKey: "projects", header: "Projects" },
    { accessorKey: "gstin", header: "GSTIN", cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) ?? "—"}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: r } }) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.preferred && <Badge tone="success">Preferred</Badge>}</div> },
  ];
  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        csvName="vendors"
        searchPlaceholder="Search vendors…"
        filters={
          <>
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto" aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select value={city} onChange={(e) => setCity(e.target.value)} className="w-auto" aria-label="City"><option value="">All cities</option>{cities.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select value={minRating} onChange={(e) => setMinRating(e.target.value)} className="w-auto" aria-label="Minimum rating"><option value="">Any rating</option><option value="4.5">4.5★+</option><option value="4">4★+</option><option value="3.5">3.5★+</option><option value="2.5">2.5★+</option></Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="ON_HOLD">On hold</option><option value="BLACKLISTED">Blacklisted</option></Select>
          </>
        }
        toolbar={canEdit && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New vendor</Button>}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New vendor" description="Add it to a project's vendor book from Project Settings to include it in RFQs." wide>
          <VendorForm categories={categories} materials={materials} onSaved={(id) => { setCreating(false); router.push(`/vendors/${id}`); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
