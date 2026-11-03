import { defineConfig, devices } from "@playwright/test";

// Smoke test against a seeded app in demo mode: `npm run db:seed && npx playwright install chromium && npm run test:e2e`
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 180_000 },
});
