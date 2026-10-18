import { describe, expect, it } from "vitest";
import { overall, renderDashboard, type Board } from "./render.ts";

const row = (pattern: "drip_pricing" | "nagging", tp: number, fp: number, fn: number) => ({
  pattern, tp, fp, fn, tn: 0, review: 0, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
});

describe("overall", () => {
  it("pools counts rather than averaging per-pattern rates", () => {
    const o = overall([row("drip_pricing", 9, 0, 1), row("nagging", 1, 0, 1)]);
    expect(o.recall).toBeCloseTo(10 / 12);
    expect(o.precision).toBe(1);
  });
  it("is null when nothing was predicted or expected", () => {
    expect(overall([row("nagging", 0, 0, 0)])).toEqual({ precision: null, recall: null });
  });
});

describe("renderDashboard", () => {
  const boards: Board[] = [{ id: "rules", title: "Rules <b>", blurb: "x", scores: { test: [row("drip_pricing", 8, 0, 2)] } }];
  const html = renderDashboard({ boards, generatedAt: "2026-10-18", commit: "abcdef1234", benchUrl: "https://x/", repoUrl: "https://y/" });

  it("prints the held-out recall and the commit", () => {
    expect(html).toContain("80.0%");
    expect(html).toContain("abcdef1");
  });
  it("escapes titles", () => {
    expect(html).not.toContain("Rules <b>");
    expect(html).toContain("Rules &lt;b&gt;");
  });
});
