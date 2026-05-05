import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      JWT_SECRET: "test-secret-for-unit-tests-min-32-chars",
      DATABASE_URL: "file:./test.db",
    },
  },
});
