// One source of truth for the session cookie, shared by the NextAuth handler (Node) and the middleware (Edge).
// NextAuth decides "secure" from the request origin while its middleware decides from NEXTAUTH_URL; behind an
// HTTPS proxy (Render, Railway, Nginx…) those can disagree and the login loops. Both now use this.
// Keep this file dependency-free (it runs in the Edge runtime).

const base = process.env.NEXTAUTH_URL || process.env.APP_URL || "";

/** Secure cookies whenever the public URL is https (always the case in a real deployment). */
export const useSecureCookies = base.startsWith("https://");

export const SESSION_COOKIE = useSecureCookies ? "__Secure-next-auth.session-token" : "next-auth.session-token";

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: useSecureCookies,
};
