import { LogoTile } from "@/components/logo";

export const metadata = { title: "Vendor portal", robots: { index: false, follow: false } };

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-brand-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-2">
          <LogoTile height={44} className="px-3" />
          <span className="text-xs text-white/70">Secure supplier portal</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-muted">This link is unique to your company and this request. Please do not share it.</footer>
    </div>
  );
}
