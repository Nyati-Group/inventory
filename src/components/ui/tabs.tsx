"use client";

import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = (p: T.TabsContentProps) => <T.Content {...p} className={cn("pt-4 focus:outline-none", p.className)} />;

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <T.List className={cn("scrollbar-thin flex gap-1 overflow-x-auto border-b border-border", className)}>{children}</T.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <T.Trigger
      value={value}
      className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-brand-800 data-[state=active]:border-brand-600 data-[state=active]:text-brand-600"
    >
      {children}
    </T.Trigger>
  );
}
