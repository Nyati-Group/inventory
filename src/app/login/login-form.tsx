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

export function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" className="w-full" loading={loading}>
        Sign in
      </Button>
    </form>
  );
}
