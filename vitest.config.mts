import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DB_PORT = 54330;
const TEST_DB_NAME = "afrigest_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
      "next/cache": path.resolve(import.meta.dirname, "tests/stubs/next-cache.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: `postgresql://afrigest_app:test_app_pw@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}`,
      DIRECT_URL: `postgresql://postgres:postgres@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}`,
      APP_DB_PASSWORD: "test_app_pw",
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      AUTH_SECRET: "test-secret",
      REQUIRE_EMAIL_VERIFICATION: "false",
    },
  },
});
