"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import * as D from "@radix-ui/react-dialog";
import { signOut } from "next-auth/react";
import { Bell, Check, ChevronDown, Menu, Plus, Search, MapPin, Mail } from "lucide-react";
import { toast } from "sonner";
import { SidebarBody } from "./sidebar";
import { TITLES } from "./nav";
import { cn, fmtDateTime } from "@/lib/utils";
import { selectProject, markNotificationsRead } from "@/server/actions/shell";
import { NewProjectDialog } from "./new-project-dialog";

export interface ShellProps {
  user: { name: string; email: string; role: string; roleLabel: string };
  projects: { id: string; code: string; name: string; city: string }[];
  currentProjectId: string | null;
  notifications: { id: string; title: string; body: string | null; link: string | null; createdAt: string; readAt: string | null }[];
  demoMode: boolean;
  canCreateProject: boolean;
  children: React.ReactNode;
}

export function AppShell(p: ShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("nyati.sidebar") === "collapsed");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("nyati.sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 transition-[width] lg:block", collapsed ? "w-[72px]" : "w-60")}>
        <SidebarBody role={p.user.role} roleLabel={p.user.roleLabel} name={p.user.name} collapsed={collapsed} onToggle={toggle} />
      </aside>
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden" aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            <SidebarBody role={p.user.role} roleLabel={p.user.roleLabel} name={p.user.name} onNavigate={() => setMobileOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...p} onMenu={() => setMobileOpen(true)} />
        {p.demoMode && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 sm:px-6">
            <strong>Demo mode:</strong> emails are not sent — they appear in the{" "}
            <Link href="/outbox" className="font-semibold underline">Demo Outbox</Link> with working vendor links.
          </div>
        )}
        <main className="flex-1 px-4 py-5 sm:px-6">{p.children}</main>
      </div>
    </div>
  );
}

function Topbar(p: ShellProps & { onMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = "/" + (pathname.split("/")[1] ?? "");
  const title = TITLES[section] ?? (section === "/outbox" ? "Demo Outbox" : section === "/search" ? "Search" : "");
  const sub = pathname.split("/").slice(2).filter(Boolean);
  const unread = p.notifications.filter((n) => !n.readAt).length;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white/95 px-4 backdrop-blur sm:px-6">
      <button className="rounded-md p-2 text-brand-800 hover:bg-brand-100 lg:hidden" onClick={p.onMenu} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="hidden text-xs text-muted sm:block">
          <Link href="/procurement" className="hover:text-brand-600">Home</Link>
          {title && (<> / <Link href={section} className="hover:text-brand-600">{title}</Link></>)}
          {sub.length > 0 && <> / <span>Details</span></>}
        </nav>
        <div className="truncate text-base font-semibold text-brand-800">{title}</div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ProjectSelector projects={p.projects} currentProjectId={p.currentProjectId} canCreate={p.canCreateProject} />
        <form
          className="relative hidden md:block"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            if (q) router.push(`/search?q=${encodeURIComponent(String(q))}`);
          }}
          role="search"
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <input name="q" placeholder="Search materials, vendors, RFQs, POs…" aria-label="Global search" className="h-9 w-64 rounded-lg border border-border bg-bg pl-8 pr-3 text-sm focus:border-brand-600 focus:outline-none lg:w-72" />
        </form>
        {p.demoMode && (
          <Link href="/outbox" className="rounded-md p-2 text-brand-800 hover:bg-brand-100" aria-label="Demo outbox" title="Demo outbox">
            <Mail className="h-5 w-5" />
          </Link>
        )}
        <Notifications items={p.notifications} unread={unread} />
        <UserMenu user={p.user} />
      </div>
    </header>
  );
}

function ProjectSelector({ projects, currentProjectId, canCreate }: { projects: ShellProps["projects"]; currentProjectId: string | null; canCreate: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const current = projects.find((x) => x.id === currentProjectId);
  const list = projects.filter((x) => `${x.name} ${x.city} ${x.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button className="flex h-9 max-w-[220px] items-center gap-2 rounded-lg border border-border bg-white px-3 text-left text-sm hover:bg-brand-100" aria-label="Select project">
            <MapPin className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-brand-800">{current?.name ?? "Select project"}</span>
            </span>
            <span className="hidden truncate text-xs text-muted sm:inline">{current?.city}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted", pending && "animate-pulse")} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className="z-50 w-72 rounded-lg border border-border bg-white p-2 shadow-lg">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" className="mb-2 h-8 w-full rounded-md border border-border px-2 text-sm focus:border-brand-600 focus:outline-none" />
            <ul className="max-h-64 overflow-y-auto" role="listbox">
              {list.map((x) => (
                <li key={x.id}>
                  <button
                    role="option"
                    aria-selected={x.id === currentProjectId}
                    onClick={() =>
                      start(async () => {
                        const r = await selectProject(x.id);
                        if (!r.ok) toast.error(r.error);
                        setOpen(false);
                      })
                    }
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-brand-100"
                  >
                    <span>
                      <span className="block font-medium text-brand-800">{x.name}</span>
                      <span className="text-xs text-muted">{x.code} · {x.city}</span>
                    </span>
                    {x.id === currentProjectId && <Check className="h-4 w-4 text-brand-600" />}
                  </button>
                </li>
              ))}
              {!list.length && <li className="px-2 py-3 text-sm text-muted">No projects found</li>}
            </ul>
            {canCreate && (
              <button onClick={() => { setOpen(false); setNewOpen(true); }} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 pt-2 text-sm font-medium text-brand-600 hover:text-brand-500">
                <Plus className="h-4 w-4" /> New project
              </button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}

function Notifications({ items, unread }: { items: ShellProps["notifications"]; unread: number }) {
  const [pending, start] = React.useTransition();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative rounded-md p-2 text-brand-800 hover:bg-brand-100" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 rounded-lg border border-border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-brand-800">Notifications</span>
            {unread > 0 && (
              <button disabled={pending} onClick={() => start(async () => void (await markNotificationsRead()))} className="text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-border last:border-0", !n.readAt && "bg-brand-100/50")}>
                <Popover.Close asChild>
                  <Link href={n.link ?? "#"} className="block px-3 py-2 hover:bg-slate-50">
                    <div className="text-sm font-medium text-brand-800">{n.title}</div>
                    {n.body && <div className="text-xs text-muted">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-muted">{fmtDateTime(n.createdAt)}</div>
                  </Link>
                </Popover.Close>
              </li>
            ))}
            {!items.length && <li className="px-3 py-6 text-center text-sm text-muted">You're all caught up.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UserMenu({ user }: { user: ShellProps["user"] }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white" aria-label="User menu">
          {user.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-60 rounded-lg border border-border bg-white p-2 shadow-lg">
          <div className="px-2 py-1.5">
            <div className="text-sm font-semibold text-brand-800">{user.name}</div>
            <div className="text-xs text-muted">{user.email}</div>
            <div className="mt-1 text-xs font-medium text-brand-600">{user.roleLabel}</div>
          </div>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-red-50">
            Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
