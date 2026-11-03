import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Wrap a server action body so the client always gets a serialisable success/error result. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { ok: false, error: `A record with this ${(e.meta?.target as string[] | undefined)?.join(", ") ?? "value"} already exists` };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { ok: false, error: (e as Error).message || "Something went wrong" };
  }
}
