// Create (or reset) an admin user on a fresh database.
// Usage: npm run create-admin -- admin@nyati.in "Full Name" "a-strong-password"
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mongoUrl } from "../src/lib/mongo-url.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <email> "<full name>" "<password, 8+ chars>"');
  process.exit(1);
}
const datasourceUrl = mongoUrl();
if (!datasourceUrl) {
  console.error("Set MONGODB_URI and MONGODB_DB in .env (see .env.example).");
  process.exit(1);
}
const db = new PrismaClient({ datasourceUrl });
const passwordHash = await bcrypt.hash(password, 10);
const user = await db.user.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), name, passwordHash, role: "ADMIN" },
  update: { name, passwordHash, role: "ADMIN", isActive: true },
});
console.log(`Admin ready: ${user.email} (sign in at ${process.env.APP_URL ?? "your app URL"}/login)`);
await db.$disconnect();
