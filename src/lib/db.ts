import { PrismaClient } from "@prisma/client";
import { mongoUrl } from "./mongo-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const url = mongoUrl();
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // Prisma's default (wait 2 s, run 5 s) is too tight when the server and Atlas are far apart or a
    // serverless instance is cold — a slow network then fails otherwise-valid writes (P2028).
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  });
}

export const db = globalForPrisma.prisma ?? create();

/**
 * MongoDB: Prisma doesn't store optional fields that were never set, and `{ field: null }` only matches
 * fields explicitly set to null. Use `isSet` for "never set" filters (soft delete, unread, etc.).
 */
export const notDeleted = { isSet: false } as const;
export const unset = { isSet: false } as const;

// Reuse one client per process (dev hot-reload, and warm serverless instances).
globalForPrisma.prisma = db;
