import { withAuth } from "next-auth/middleware";
import { SESSION_COOKIE } from "@/lib/auth-cookies";

// Same cookie name as the NextAuth handler (see auth-cookies.ts) so a signed-in user is recognised behind HTTPS proxies.
export default withAuth({
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: { sessionToken: { name: SESSION_COOKIE } },
});

// Everything except the login page, auth API, health check, public vendor portal, vendor APIs, signed file
// downloads, cron and static assets requires a session.
export const config = {
  matcher: ["/((?!login|api/auth|api/health|api/vendor|api/files|api/cron|vendor/|_next|favicon|nyati).*)"],
};
