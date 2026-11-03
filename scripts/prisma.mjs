// Runs the Prisma CLI with DATABASE_URL built from MONGODB_URI + MONGODB_DB in .env.
// Usage: node scripts/prisma.mjs db push
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mongoUrl } from "../src/lib/mongo-url.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = mongoUrl();
if (!url) {
  console.error("Set MONGODB_URI and MONGODB_DB in .env (see .env.example).");
  process.exit(1);
}
const r = spawnSync("npx", ["prisma", ...process.argv.slice(2)], { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);
