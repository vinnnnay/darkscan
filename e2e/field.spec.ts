import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { auditShop } from "../packages/field/src/sweep.ts";

const BASE = "http://localhost:4173";
test.setTimeout(120_000);
// The audit records its own trace; the runner tracing the same contexts would collide with it.
test.use({ trace: "off" });

// The sweep's glue: one shop in, a table row plus an openable report out. Run against DarkBench so
// it is checked even when every real shop is blocking us.
test("auditing one shop yields a row, findings and a report beside the screenshots", async ({}, info) => {
  const shop = { id: "darkbench", name: "DarkBench", home: `${BASE}/?v=1`, probes: [] };
  const { row, recipe, findings } = await auditShop(shop, { outDir: info.outputPath(), politeDelayMs: 0 }, {}, null);

  expect(row).toMatchObject({ id: "darkbench", name: "DarkBench", outcome: "reached-goal", modelCalls: 0 });
  expect(row.steps).toBeGreaterThan(3);
  expect(row.stop).not.toContain("\n");
  expect(recipe.steps[0]).toMatchObject({ do: "goto" });

  expect(findings.map((f) => f.pattern)).toContain("nagging");

  const report = await readFile(join(info.outputPath(), row.runId, "report.html"), "utf8");
  expect(report).toContain("DarkScan report");
  expect(report).toContain("What this audit could not see");
});

// A shop that never loads must not look like a shop that was audited and came back clean.
test("a shop that cannot be reached is reported as a failure, not as a clean audit", async ({}, info) => {
  const shop = { id: "gone", name: "Gone", home: "http://localhost:4199/", probes: [] };
  const { row, findings } = await auditShop(shop, { outDir: info.outputPath(), politeDelayMs: 0 }, {}, null);

  expect(row.outcome).toBe("failed");
  expect(findings).toEqual([]);
});
