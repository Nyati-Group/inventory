import { runDueJobs } from "./lib/jobs";

// Background worker: one sweep per minute (emails, parsing, reminders, deadlines, delivery delays, low stock).
// Not on serverless hosts (Vercel/Lambda): there a timer would run inside the same instances that serve pages and
// slow them down; the scheduled /api/cron call (vercel.json) does the sweep instead.
const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (process.env.DISABLE_JOB_RUNNER !== "true" && !serverless) {
  const tick = () => runDueJobs().catch((e) => console.error("[jobs]", (e as Error).message));
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
