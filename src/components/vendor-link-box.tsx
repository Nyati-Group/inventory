"use client";

import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "./ui/button";

/** Shows a vendor link with copy / open / WhatsApp share. */
export function VendorLinkBox({ title, description, link, whatsappUrl }: { title: string; description: string; link: string; whatsappUrl: string | null }) {
  return (
    <section className="card p-4">
      <div className="mb-1 text-sm font-semibold text-brand-800">{title}</div>
      <p className="mb-2 text-xs text-muted">{description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-slate-50 px-2 py-1.5 text-xs" title={link}>{link}</code>
        <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }}><Copy className="h-4 w-4" /> Copy</Button>
        <Button size="sm" variant="secondary" asChild><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
        {whatsappUrl && <Button size="sm" variant="secondary" asChild><a href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp</a></Button>}
      </div>
    </section>
  );
}
