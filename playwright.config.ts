import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  webServer: {
    command: "node apps/darkbench/scripts/serve.ts",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
