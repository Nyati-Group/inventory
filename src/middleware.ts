export { default } from "next-auth/middleware";

// Everything except the login page, auth API, public vendor portal, vendor APIs, signed file downloads, cron and static assets requires a session.
export const config = {
  matcher: ["/((?!login|api/auth|api/vendor|api/files|api/cron|vendor/|_next|favicon|nyati).*)"],
};
