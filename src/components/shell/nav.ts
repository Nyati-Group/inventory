import {
  ShoppingCart,
  FileText,
  ClipboardList,
  Truck,
  Building2,
  Star,
  BarChart3,
  FolderCog,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

/** Sidebar order is fixed by the spec (§2). */
export const NAV: NavItem[] = [
  { href: "/procurement", label: "Procurement", icon: ShoppingCart },
  { href: "/rfqs", label: "RFQs & Quotations", icon: FileText },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { href: "/deliveries", label: "Deliveries & GRN", icon: Truck },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/vendor-ratings", label: "Vendor Ratings", icon: Star },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/project-settings", label: "Project Settings", icon: FolderCog },
  { href: "/system-settings", label: "System Settings", icon: Settings, adminOnly: true },
];

export const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));
