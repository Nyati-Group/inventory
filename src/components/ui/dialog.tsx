"use client";

import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-white shadow-xl",
          wide ? "max-w-6xl" : "max-w-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <D.Title className="text-base font-semibold text-brand-800">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted hover:bg-brand-100" aria-label="Close">
            <X className="h-4 w-4" />
          </D.Close>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-6 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/** Right-side drawer. */
export function SheetContent({ title, description, children, width = "max-w-2xl" }: { title: string; description?: string; children: React.ReactNode; width?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
      <D.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-white shadow-xl", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <D.Title className="text-base font-semibold text-brand-800">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted hover:bg-brand-100" aria-label="Close">
            <X className="h-4 w-4" />
          </D.Close>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/** Confirm dialog for destructive or outward-facing actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <D.Close className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-brand-800 hover:bg-brand-100">Cancel</D.Close>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn("h-9 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50", danger ? "bg-danger hover:bg-red-700" : "bg-brand-600 hover:bg-brand-500")}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
