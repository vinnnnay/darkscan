import { defineConfig } from "@playwright/test";
import { chromiumArgs } from "./packages/crawler/src/index.ts";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    // Matches the audit session's own launch, so the suite runs in the project's container too.
    launchOptions: { args: chromiumArgs() },
  },
  webServer: {
    command: "node apps/darkbench/scripts/serve.ts",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
