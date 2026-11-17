"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  RATE_LIMITED: "Too many attempts. Please wait 5 minutes and try again.",
  SERVER_UNAVAILABLE: "The server can't reach the database right now. Please try again shortly or contact the administrator.",
};

/**
 * Only follow same-site paths after login. Behind a proxy the middleware may build callbackUrl with the
 * internal host (e.g. http://localhost:10000/…), so keep just the path; this also blocks open redirects.
 */
function safeTarget(raw: string | null) {
  if (!raw) return "/procurement";
  try {
    const u = new URL(raw, window.location.origin);
    const path = `${u.pathname}${u.search}${u.hash}`;
    return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login") ? path : "/procurement";
  } catch {
    return "/procurement";
  }
}

const DEMO_PASSWORD = "nyati123";
const DEMO_ACCOUNTS = [
  { email: "buyer@nyati.in", role: "Procurement Manager" },
  { email: "approver@nyati.in", role: "Approver (Project Head)" },
  { email: "finance@nyati.in", role: "Approver (Finance)" },
  { email: "site@nyati.in", role: "Site / Store Engineer" },
];

export function LoginForm({ demoMode = false }: { demoMode?: boolean }) {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function pick(account: string) {
    setEmail(account);
    setPassword(DEMO_PASSWORD);
    setError(null);
    document.getElementById("password")?.focus();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirect: false });
      if (!res || res.error) {
        setLoading(false);
        return setError(MESSAGES[res?.error ?? ""] ?? "Sign-in failed. Please try again.");
      }
      // Full page load so the new session cookie is sent with the very next request.
      window.location.assign(safeTarget(params.get("callbackUrl")));
    } catch {
      setLoading(false);
      setError("Could not reach the server. Check your connection and try again.");
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      {demoMode && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold text-brand-800">Demo accounts — click to fill in</div>
          <div className="grid gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => pick(a.email)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-brand-600 hover:bg-brand-100 ${email === a.email ? "border-brand-600 bg-brand-100" : "border-border"}`}
              >
                <span className="font-medium text-brand-800">{a.role}</span>
                <span className="text-muted">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
