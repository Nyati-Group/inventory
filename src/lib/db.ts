import { PrismaClient } from "@prisma/client";
import { mongoUrl } from "./mongo-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const url = mongoUrl();
  return new PrismaClient({
    ...(url ? { datasourceUrl: url } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? create();

/**
 * MongoDB: Prisma doesn't store optional fields that were never set, and `{ field: null }` only matches
 * fields explicitly set to null. Use `isSet` for "never set" filters (soft delete, unread, etc.).
 */
export const notDeleted = { isSet: false } as const;
export const unset = { isSet: false } as const;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
