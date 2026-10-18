import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditRun, Finding, Step } from "@darkscan/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSessions, renderSummary, type Session } from "./aggregate.ts";

const step = (index: number, action = "goto /"): Step => ({
  index,
  action,
  url: "https://shop.test/",
  at: "2026-10-18T00:00:00.000Z",
  screenshot: "",
  dom: "",
  visibleText: "",
  price: null,
  cart: null,
  dialog: null,
  checkboxes: [],
  links: [],
});

const run = (target: string, steps: Step[] = [step(0)]): AuditRun => ({
  id: "r",
  target,
  startedAt: "2026-10-18T00:00:00.000Z",
  finishedAt: null,
  status: "completed",
  note: null,
  trace: null,
  steps,
});

const finding = (pattern: Finding["pattern"], status: Finding["status"] = "likely"): Finding => ({
  pattern,
  status,
  confidence: 0.9,
  detector: "rule",
  evidenceSteps: [0],
  explanation: "x",
});

const session = (name: string, target: string, findings: Finding[], steps?: Step[]): Session => ({ name, run: run(target, steps), findings });

describe("renderSummary", () => {
  it("counts sessions and shops, treating www and bare hosts as one shop", () => {
    const md = renderSummary([session("a", "https://www.shop.test", []), session("b", "https://shop.test", []), session("c", "https://other.test", [])]);
    expect(md).toContain("**3 recorded sessions** on **2 shops**");
    expect(md).toContain("## shop.test");
    expect(md).toContain("2 sessions (too few");
  });

  it("counts a session once per pattern, however often it showed up inside that session", () => {
    const s = session("a", "https://shop.test", [finding("nagging"), finding("nagging"), finding("drip_pricing", "review")]);
    const md = renderSummary([s, session("b", "https://shop.test", [finding("nagging")]), session("c", "https://shop.test", [])]);
    expect(md).toContain("| Nagging | 2 | 0 | 3 |");
    expect(md).toContain("| Drip pricing | 0 | 1 | 3 |");
    expect(md).not.toContain("too few"); // three sessions on this shop
  });

  it("prefers likely over review within one session", () => {
    const md = renderSummary([session("a", "https://shop.test", [finding("nagging", "review"), finding("nagging", "likely")])]);
    expect(md).toContain("| Nagging | 1 | 0 | 1 |");
  });

  it("says when nothing was found, and counts sessions that reached payment", () => {
    const md = renderSummary([session("a", "https://shop.test", [], [step(0), step(1, "payment page reached: recording stopped")])]);
    expect(md).toContain("No potential patterns found");
    expect(md).toContain("1 reached payment");
  });

  it("never calls anything a violation, and warns against publishing without checking evidence", () => {
    const md = renderSummary([session("a", "https://shop.test", [finding("nagging")])]).toLowerCase();
    expect(md).toContain("potential");
    expect(md).toContain("not legal findings");
    for (const word of ["illegal", "guilty", "violation"]) expect(md).not.toContain(word);
  });

  it("lists skipped bundles", () => {
    expect(renderSummary([], ["bad: run.json is not valid JSON."])).toContain("- bad: run.json is not valid JSON.");
  });
});

describe("loadSessions", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "darkscan-agg-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads valid bundles and skips, with a reason, the ones that are not", async () => {
    await mkdir(join(root, "good"));
    await writeFile(join(root, "good", "run.json"), JSON.stringify(run("https://shop.test")));
    await mkdir(join(root, "bad"));
    await writeFile(join(root, "bad", "run.json"), "{nope");
    await mkdir(join(root, "empty"));
    await writeFile(join(root, "stray-file.txt"), "ignored");

    const { sessions, skipped } = await loadSessions(root, () => [finding("nagging")]);
    expect(sessions.map((s) => s.name)).toEqual(["good"]);
    expect(sessions[0]!.findings).toHaveLength(1);
    expect(skipped.map((s) => s.split(":")[0]).sort()).toEqual(["bad", "empty"]);
  });
});
