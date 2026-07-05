import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests drive full games over real sockets.
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
