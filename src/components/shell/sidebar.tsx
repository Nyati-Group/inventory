"use client";

import Link from "next/link";
import { LogoTile } from "@/components/logo";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/lib/utils";

export function SidebarBody({ role, roleLabel, name, collapsed, onToggle, onNavigate }: {
  role: string;
  roleLabel: string;
  name: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.adminOnly || role === "ADMIN");
  return (
    <div className="flex h-full flex-col bg-brand-800 text-white">
      <div className={cn("flex items-center justify-center border-b border-white/10 px-4 py-3", collapsed && "px-2")}>
        {collapsed ? <LogoTile height={32} emblemOnly /> : <LogoTile height={64} className="px-6" />}
      </div>
      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Main">
        {items.map((n) => {
          const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              title={collapsed ? n.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white",
                active && "bg-brand-600 text-white before:absolute before:-left-2 before:top-1.5 before:h-6 before:w-1 before:rounded-r before:bg-white",
                collapsed && "justify-center px-2",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className={cn("flex items-center gap-3", collapsed && "flex-col")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold" aria-hidden>
            {name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{name}</div>
              <div className="truncate text-xs text-white/60">{roleLabel}</div>
            </div>
          )}
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {onToggle && (
          <button onClick={onToggle} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : (<><ChevronsLeft className="h-4 w-4" /> Collapse</>)}
          </button>
        )}
      </div>
    </div>
  );
}
