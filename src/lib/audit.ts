import { Prisma } from "@prisma/client";
import { db } from "./db";
import { plain } from "./utils";

type Actor = { id: string; name: string } | { label: string };

/** Write an audit entry for every state change: who, what, when, old → new. */
export async function audit(
  actor: Actor,
  entityType: string,
  entityId: string,
  action: string,
  opts: { before?: unknown; after?: unknown; projectId?: string | null; ip?: string | null } = {},
  tx: Prisma.TransactionClient = db,
) {
  await tx.auditLog.create({
    data: {
      actorId: "id" in actor ? actor.id : null,
      actorLabel: "id" in actor ? actor.name : actor.label,
      entityType,
      entityId,
      action,
      before: opts.before === undefined ? undefined : (plain(opts.before) as Prisma.InputJsonValue),
      after: opts.after === undefined ? undefined : (plain(opts.after) as Prisma.InputJsonValue),
      projectId: opts.projectId ?? null,
      ip: opts.ip ?? null,
    },
  });
}
