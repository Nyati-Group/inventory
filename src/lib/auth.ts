import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { rateLimit } from "./rate-limit";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password || !rateLimit(`login:${email}`, 10, 5 * 60_000)) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.isActive || user.deletedAt) return null;
        if (!(await bcrypt.compare(password, user.passwordHash))) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as unknown as { role: Role }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
};

export type SessionUser = { id: string; name: string; email: string; role: Role };

export async function getUser(): Promise<SessionUser | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.id) return null;
  return { id: s.user.id, name: s.user.name ?? "", email: s.user.email ?? "", role: s.user.role };
}

/** For server components/pages: redirects to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export class AuthError extends Error {}

/** For server actions: throws when the role is not allowed. Always enforce on the server. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new AuthError("Not signed in");
  if (roles.length && !roles.includes(u.role) && u.role !== "ADMIN") throw new AuthError("You don't have permission for this action");
  return u;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  PROCUREMENT_MANAGER: "Procurement Manager",
  APPROVER: "Approver",
  SITE_ENGINEER: "Site / Store Engineer",
};

/** Capability map used by the UI to hide controls (server actions re-check with requireRole). */
export const CAN = {
  manageRfq: ["ADMIN", "PROCUREMENT_MANAGER"] as Role[],
  approve: ["ADMIN", "APPROVER"] as Role[],
  manageStock: ["ADMIN", "PROCUREMENT_MANAGER", "SITE_ENGINEER"] as Role[],
  receiveGoods: ["ADMIN", "SITE_ENGINEER", "PROCUREMENT_MANAGER"] as Role[],
  manageVendors: ["ADMIN", "PROCUREMENT_MANAGER"] as Role[],
  manageProject: ["ADMIN", "PROCUREMENT_MANAGER"] as Role[],
  admin: ["ADMIN"] as Role[],
};

export function can(user: { role: Role }, cap: keyof typeof CAN) {
  return CAN[cap].includes(user.role);
}
