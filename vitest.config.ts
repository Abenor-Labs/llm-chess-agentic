import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

/**
 * Two projects:
 * - unit: pure tests next to the code (src/**), run in parallel
 * - db:   integration tests against a real Postgres (tests/**), run serially
 *         because they share one database. They are skipped unless
 *         TEST_DATABASE_URL is set (see tests/README in AGENTS.md).
 * Playwright e2e specs live in e2e/ and run via `pnpm test:e2e`.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          globalSetup: ["./tests/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
