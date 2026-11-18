"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, RotateCcw, SendHorizontal, X } from "lucide-react";
import { EMBLEM_SRC } from "@/components/logo";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; text: string; error?: boolean };

const STORE_KEY = "nyati-copilot-chat";
const SUGGESTIONS = [
  "Give me an overview of the current project",
  "Which materials are low on stock?",
  "Which deliveries are overdue?",
  "Compare quotes in the latest cement RFQ",
  "What approvals are pending?",
  "Top vendors for steel by rating",
];

function load(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}
function save(m: Msg[]) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(m.slice(-30)));
  } catch {
    /* storage unavailable — chat just isn't kept across pages */
  }
}

/** The NYATI emblem in a white circle — the copilot's icon. */
function Emblem({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={EMBLEM_SRC} alt="" width={size} height={size} className="rounded-full" />;
}

export function Copilot({ userName }: { userName: string }) {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => setMessages(load()), []);
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);
  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages.filter((m) => !m.error), { role: "user" as const, text: q }];
    setMessages(next);
    save(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-14).map(({ role, text }) => ({ role, text })) }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      const reply: Msg = res.ok && j.text ? { role: "assistant", text: j.text } : { role: "assistant", text: j.error ?? "Something went wrong. Please try again.", error: true };
      const all = [...next, reply];
      setMessages(all);
      save(all.filter((m) => !m.error));
    } catch {
      setMessages([...next, { role: "assistant", text: "Couldn't reach the server. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setMessages([]);
    save([]);
  }

  const firstName = userName.split(" ")[0];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open NYATI Copilot"
          title="NYATI Copilot"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-white p-1 shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <Emblem size={48} />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="NYATI Copilot"
          className="fixed bottom-5 right-5 z-50 flex h-[min(620px,calc(100vh-2.5rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
        >
          <header className="flex items-center gap-3 bg-brand-800 px-4 py-3 text-white">
            <span className="rounded-full bg-white p-0.5"><Emblem size={30} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">NYATI Copilot</div>
              <div className="text-[11px] text-white/70">Procurement &amp; inventory assistant</div>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={clear} className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white" aria-label="New chat" title="New chat">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close copilot" title="Close">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4" aria-live="polite">
            {!messages.length && (
              <div className="space-y-3">
                <div className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-border">
                  <p className="font-medium text-brand-800">Hi {firstName}! 👋</p>
                  <p className="mt-1 text-muted">
                    Ask me about stock, RFQs, quotations, vendors, approvals, purchase orders, deliveries or rates — I read the live data for your projects. I only answer procurement questions.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border bg-white px-3 py-1.5 text-left text-xs text-brand-800 hover:border-brand-600 hover:bg-brand-100">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-8 flex justify-end">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">{m.text}</div>
                </div>
              ) : (
                <div key={i} className="mr-4 flex gap-2">
                  <span className="mt-0.5 shrink-0"><Emblem size={24} /></span>
                  <div className={cn("min-w-0 rounded-2xl rounded-tl-sm px-3 py-2 text-sm shadow-sm ring-1", m.error ? "bg-red-50 text-danger ring-red-100" : "bg-white ring-border")}>
                    {m.error ? m.text : <Markdown text={m.text} onNavigate={() => window.innerWidth < 640 && setOpen(false)} />}
                  </div>
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Emblem size={24} />
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking that up…
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask about procurement…"
              aria-label="Message"
              className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40">
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

// ───────────── tiny, safe markdown renderer (no HTML injection) ─────────────

function Inline({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const out: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[2];
      if (href.startsWith("/") && !href.startsWith("//")) out.push(<Link key={k++} href={href} onClick={onNavigate} className="link font-medium">{m[1]}</Link>);
      else if (/^https?:\/\//.test(href)) out.push(<a key={k++} href={href} target="_blank" rel="noreferrer" className="link">{m[1]}</a>);
      else out.push(m[1]);
    } else if (m[3]) out.push(<strong key={k++} className="font-semibold text-brand-800">{m[3]}</strong>);
    else if (m[4]) out.push(<code key={k++} className="rounded bg-slate-100 px-1 text-[12px]">{m[4]}</code>);
    else if (m[5]) out.push(<em key={k++}>{m[5]}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Markdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { blocks.push(<hr key={k++} className="my-2 border-border" />); i++; continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { blocks.push(<div key={k++} className="mt-1 font-semibold text-brand-800"><Inline text={h[2]} onNavigate={onNavigate} /></div>); i++; continue; }
    if (l.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const head = cells(l);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="-mx-1 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-border px-1.5 py-1 text-left font-semibold text-brand-800"><Inline text={c} onNavigate={onNavigate} /></th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-border/60 last:border-0">{r.map((c, j) => <td key={j} className="px-1.5 py-1 align-top"><Inline text={c} onNavigate={onNavigate} /></td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]/.test(l);
      const items: { text: string; nested: boolean }[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""), nested: /^\s{2,}/.test(lines[i]) });
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k++} className={cn("space-y-0.5 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => <li key={j} className={it.nested ? "ml-4" : undefined}><Inline text={it.text} onNavigate={onNavigate} /></li>)}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*\||\s*([-*•]|\d+[.)])\s+|\s*-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={k++}><Inline text={para.join(" ")} onNavigate={onNavigate} /></p>);
  }
  return <div className="space-y-2 break-words leading-relaxed">{blocks}</div>;
}
