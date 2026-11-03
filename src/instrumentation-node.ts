import { runDueJobs } from "./lib/jobs";

// Background worker: one sweep per minute (emails, parsing, reminders, deadlines, delivery delays, low stock).
if (process.env.DISABLE_JOB_RUNNER !== "true") {
  const tick = () => runDueJobs().catch((e) => console.error("[jobs]", (e as Error).message));
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
