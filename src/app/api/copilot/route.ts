import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { currentProject } from "@/lib/project-context";
import { rateLimit } from "@/lib/rate-limit";
import { copilotReply } from "@/lib/copilot/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).min(1).max(40),
});

/** NYATI Copilot: answers procurement questions from live app data (signed-in users only). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!rateLimit(`copilot:${user.id}`, 20, 60_000)) return NextResponse.json({ error: "You're asking very quickly — please wait a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { project, projects } = await currentProject(user);
  try {
    const out = await copilotReply(parsed.data.messages, {
      user,
      projectIds: projects.map((p) => p.id),
      projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name })),
      currentProjectId: project?.id ?? null,
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[copilot]", e);
    const busy = /429|503|overload|quota|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test((e as Error).message);
    return NextResponse.json({ error: busy ? "The AI service is busy right now — please try again in a moment." : "Something went wrong. Please try again." }, { status: busy ? 503 : 500 });
  }
}
