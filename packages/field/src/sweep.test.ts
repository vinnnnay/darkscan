import { describe, expect, it } from "vitest";
import type { AuditRun, Finding } from "@darkscan/schema";
import { totals, type ShopAudit } from "./sweep.ts";
import type { SweepRow } from "./markdown.ts";

const run: AuditRun = { id: "r", target: "https://s.test/", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: null, status: "completed", note: null, trace: null, steps: [] };

const finding = (status: Finding["status"]): Finding => ({
  pattern: "nagging",
  status,
  confidence: 0.9,
  detector: "rule",
  evidenceSteps: [],
  explanation: "x",
});

const audit = (outcome: SweepRow["outcome"], findings: Finding[]): ShopAudit => ({
  row: { id: "s", name: "S", outcome, reached: null, steps: 1, modelCalls: 0, stop: "", runId: "r" },
  run,
  recipe: { site: "s", baseUrl: "https://s.test", steps: [] },
  findings,
});

describe("totals", () => {
  it("counts a shop as audited only when it was reachable", () => {
    const sums = totals([audit("reached-goal", []), audit("not-auditable", [])], 5);
    expect(sums).toMatchObject({ shops: 5, audited: 1 });
  });

  it("ignores findings from a shop that blocked us, since nothing was really seen", () => {
    const sums = totals([audit("not-auditable", [finding("likely")])], 1);
    expect(sums).toMatchObject({ audited: 0, likely: 0, shopsWithAny: 0 });
  });

  it("separates likely from review, and counts each shop once", () => {
    const sums = totals([audit("stopped", [finding("likely"), finding("review"), finding("review")]), audit("stopped", [])], 2);
    expect(sums).toMatchObject({ audited: 2, likely: 1, review: 2, shopsWithAny: 1 });
  });

  it("does not count an 'ok' finding as something a person must look at", () => {
    expect(totals([audit("stopped", [finding("ok")])], 1).shopsWithAny).toBe(0);
  });
});
