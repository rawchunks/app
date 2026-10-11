import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { include: ["tests/payments/*.test.ts", "tests/payments/*.test.tsx"], environment: "jsdom", clearMocks: true },
});
