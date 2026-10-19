import { describe, expect, it } from "vitest";
import { surveyMarkdown, sweepMarkdown, type SweepRow } from "./markdown.ts";
import { outcomeOf, oneLine } from "./sweep.ts";
import type { AuditRun } from "@darkscan/schema";
import type { ShopSurvey } from "./survey.ts";

const survey = (over: Partial<ShopSurvey> = {}): ShopSurvey => ({
  id: "s",
  name: "S",
  home: { label: "home", url: "https://s.test/", origin: "https://s.test", status: "ok", allowed: true },
  probes: [{ label: "cart", url: "https://s.test/cart", origin: "https://s.test", status: "ok", allowed: false }],
  cartRules: ["/cart"],
  verdict: "browse-only",
  ...over,
});

const row = (over: Partial<SweepRow> = {}): SweepRow => ({
  id: "s", name: "S", outcome: "reached-goal", reached: "checkout", steps: 8, modelCalls: 0, stop: "reached the checkout form", runId: "s-1", ...over,
});

const run = (over: Partial<AuditRun> = {}): AuditRun => ({
  id: "r", target: "https://s.test/", startedAt: "2026-10-19T00:00:00.000Z", finishedAt: null, status: "completed", note: null, trace: null, steps: [], ...over,
});

describe("outcomeOf", () => {
  it("reports a blocked site as not auditable, never as a stop", () => {
    expect(outcomeOf(run({ status: "not_auditable" }), false)).toBe("not-auditable");
  });
  it("counts an account wall or payment page as reaching the goal", () => {
    expect(outcomeOf(run(), true)).toBe("reached-goal");
  });
  it("separates a crash from an orderly stop", () => {
    expect(outcomeOf(run({ status: "failed" }), false)).toBe("failed");
    expect(outcomeOf(run(), false)).toBe("stopped");
  });
});

describe("oneLine", () => {
  it("folds a multi-line reason and truncates it", () => {
    expect(oneLine("a\n  b")).toBe("a b");
    expect(oneLine("x".repeat(200))).toHaveLength(160);
  });
  it("drops Playwright's call log and its colour codes", () => {
    const message = 'page.goto: Timeout 60000ms exceeded. Call log: \u001b[2m - navigating to "https://s.test/"\u001b[22m';
    expect(oneLine(message)).toBe("page.goto: Timeout 60000ms exceeded.");
  });
});

describe("surveyMarkdown", () => {
  it("counts the shops that disallow a cart path", () => {
    const md = surveyMarkdown([survey(), survey({ id: "t", name: "T", verdict: "crawlable", probes: [], cartRules: [] })], "2026-10-19");
    expect(md).toContain("**1 of 2 shops disallow");
    expect(md).toContain("`/cart`");
  });
  it("escapes a pipe so the table survives third-party text", () => {
    expect(surveyMarkdown([survey({ name: "A | B" })], "2026-10-19")).toContain("A \\| B");
  });
  it("strips terminal colour codes that arrive inside an error message", () => {
    expect(surveyMarkdown([survey({ name: "\u001b[2mSlow Shop\u001b[22m" })], "2026-10-19")).toContain("Slow Shop");
    expect(surveyMarkdown([survey({ name: "\u001b[2mSlow Shop\u001b[22m" })], "2026-10-19")).not.toContain("\u001b");
  });
});

describe("sweepMarkdown", () => {
  const md = sweepMarkdown([row(), row({ id: "t", name: "T", outcome: "not-auditable", stop: "bot check" })], { shops: 2, audited: 1, likely: 3, review: 2, shopsWithAny: 1 }, { date: "2026-10-19", delayMs: 2500, model: null });

  it("reports findings only as a total, never beside a shop name", () => {
    expect(md).toContain("**3 likely and 2 to-review");
    expect(md).toContain("No finding here is attributed to a shop");
    const table = md.slice(md.indexOf("| Shop |"), md.indexOf("## Findings"));
    expect(table).not.toMatch(/likely|review/);
  });
  it("says how many shops were reachable at all", () => {
    expect(md).toContain("**1 of 2 shops could be audited at all; on 1 the agent walked the whole path");
  });
  it("names the model only when one was used", () => {
    expect(md).toContain("rules only (no language model)");
    expect(sweepMarkdown([row()], { shops: 1, audited: 1, likely: 0, review: 0, shopsWithAny: 0 }, { date: "d", delayMs: 2500, model: "qwen2.5:3b" })).toContain("`qwen2.5:3b`");
  });
});
