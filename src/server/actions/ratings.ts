"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertProjectAccess } from "@/lib/project-context";
import { adjustRating } from "@/lib/services/rating";
import { run } from "../action-result";

const Input = z.object({
  ratingId: z.string(),
  adjustments: z.array(z.object({ key: z.enum(["PRICE", "DELIVERY", "QUALITY", "RESPONSIVENESS", "COMPLIANCE"]), adjustment: z.number().min(-1).max(1), comment: z.string() })),
  feedback: z.string().max(2000).optional(),
});

export async function adjustRatingAction(input: z.infer<typeof Input>) {
  return run(async () => {
    const user = await requireRole("PROCUREMENT_MANAGER");
    const d = Input.parse(input);
    const r = await db.vendorRating.findUniqueOrThrow({ where: { id: d.ratingId } });
    await assertProjectAccess(user, r.projectId);
    await adjustRating(d.ratingId, d.adjustments, d.feedback, user);
    revalidatePath("/vendor-ratings");
    return undefined;
  });
}
