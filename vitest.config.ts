import { defineConfig } from "vitest/config";
import path from "node:path";

// `npm test` runs unit tests; `npm run test:flow` (mode "integration") runs the end-to-end
// service flow against the database in DATABASE_URL (seed it first).
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: mode === "integration" ? ["tests/integration/**/*.test.ts"] : ["tests/unit/**/*.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
}));
