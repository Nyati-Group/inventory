"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ExternalLink, Paperclip, RotateCw } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { retryEmail } from "@/server/actions/admin";
import { fmtDateTime } from "@/lib/utils";

type Email = { id: string; to: string; subject: string; html: string; status: string; attempts: number; error: string | null; createdAt: string; links: string[]; attachments: string[] };

export function OutboxView({ emails }: { emails: Email[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<Email | null>(null);
  const [pending, start] = React.useTransition();
  const cols: ColumnDef<Email, unknown>[] = [
    { accessorKey: "createdAt", header: "Time", cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{fmtDateTime(getValue() as string)}</span> },
    { accessorKey: "to", header: "To", cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> },
    { accessorKey: "subject", header: "Subject", cell: ({ row: { original: e } }) => <button className="link text-left" onClick={() => setOpen(e)}>{e.subject}</button> },
    {
      id: "links",
      header: "Vendor link",
      cell: ({ row: { original: e } }) =>
        e.links[0] ? <a href={e.links[0]} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-xs">Open as vendor <ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-muted">—</span>,
    },
    { id: "att", header: "Attachments", cell: ({ row: { original: e } }) => (e.attachments.length ? <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="h-3 w-3" />{e.attachments.join(", ")}</span> : "") },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: e } }) => <div><StatusBadge status={e.status} />{e.error && <div className="max-w-xs truncate text-xs text-danger" title={e.error}>{e.error}</div>}</div> },
    { id: "act", header: "", cell: ({ row: { original: e } }) => e.status === "FAILED" && <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => { const r = await retryEmail(e.id); r.ok ? toast.success("Retried") : toast.error(r.error); router.refresh(); })}><RotateCw className="h-4 w-4" /> Retry</Button> },
  ];
  return (
    <>
      <DataTable data={emails} columns={cols} csvName="email-log" searchPlaceholder="Search emails…" emptyTitle="No emails yet" emptyDescription="Send an RFQ from Procurement to see vendor emails here." pageSize={25} />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent title={open.subject} description={`To: ${open.to}`} wide>
            {open.links.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">{open.links.map((l) => <Button key={l} size="sm" asChild><a href={l} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open vendor link</a></Button>)}</div>
            )}
            <iframe title="Email preview" sandbox="" srcDoc={open.html} className="h-[65vh] w-full rounded-lg border border-border" />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
