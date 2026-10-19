import { describe, expect, it } from "vitest";
import { PATTERNS } from "@darkscan/schema";
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
  const html = renderDashboard({ boards, field: { survey: null, sweep: null }, generatedAt: "2026-10-18", commit: "abcdef1234", benchUrl: "https://x/", repoUrl: "https://y/" });

  it("prints the held-out recall and the commit", () => {
    expect(html).toContain("80.0%");
    expect(html).toContain("abcdef1");
  });
  it("escapes titles", () => {
    expect(html).not.toContain("Rules <b>");
    expect(html).toContain("Rules &lt;b&gt;");
  });
});

describe("the real-shop panel", () => {
  const field = {
    survey: {
      date: "2026-10-19",
      shops: [
        { id: "a", name: "A", verdict: "crawlable" as const, probes: [{ allowed: true }] },
        { id: "b", name: "B | Ltd", verdict: "browse-only" as const, probes: [{ allowed: false }] },
        { id: "c", name: "C", verdict: "browse-only" as const, probes: [{ allowed: false }] },
      ],
    },
    sweep: {
      date: "2026-10-19",
      shops: [
        { id: "a", name: "A", outcome: "reached-goal" as const },
        { id: "b", name: "B | Ltd", outcome: "not-auditable" as const },
      ],
      totals: { shops: 3, audited: 2 },
    },
  };
  const html = renderDashboard({ boards: [], field, generatedAt: "d", commit: null, benchUrl: "https://x/", repoUrl: "https://y/" });

  it("counts how many shops limit crawling, were reachable, and were audited end to end", () => {
    expect(html).toContain("2/3"); // two of three disallow a cart path
    expect(html).toContain("1/3"); // one walked the whole path
  });

  it("says plainly that this is about access, not conduct", () => {
    expect(html).toContain("This is about access, not about any shop's conduct.");
    expect(html).toContain("no finding is attributed to a named shop");
  });

  it("never prints a pattern name beside a shop, however the data arrives", () => {
    const panel = html.slice(html.indexOf('id="shops"'));
    for (const name of Object.values(PATTERNS).map((p) => p.name)) expect(panel).not.toContain(name);
  });

  it("escapes a shop name, which is third-party text", () => {
    const hostile = renderDashboard({
      boards: [],
      field: { survey: { date: "d", shops: [{ id: "x", name: "<img src=x>", verdict: "closed", probes: [] }] }, sweep: null },
      generatedAt: "d",
      commit: null,
      benchUrl: "https://x/",
      repoUrl: "https://y/",
    });
    expect(hostile).not.toContain("<img src=x>");
    expect(hostile).toContain("&lt;img src=x&gt;");
  });

  it("leaves the run column blank for a shop the sweep never reached", () => {
    const rowC = html.slice(html.indexOf(">C<"));
    expect(rowC.slice(0, 160)).toContain("–");
  });

  it("builds even when no sweep has ever been run", () => {
    const partial = renderDashboard({ boards: [], field: { survey: field.survey, sweep: null }, generatedAt: "d", commit: null, benchUrl: "https://x/", repoUrl: "https://y/" });
    expect(partial).toContain("Real shops");
    expect(partial).toContain("2/3");
  });
});
