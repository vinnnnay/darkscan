import { defineConfig } from "vitest/config";

// Unit tests only. The *.spec.ts files in e2e/ are Playwright browser tests (npm run test:e2e).
export default defineConfig({
  test: { include: ["{apps,packages}/**/*.test.ts"] },
});
