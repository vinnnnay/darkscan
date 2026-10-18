import type { AuditRun, Finding, Step } from "@darkscan/schema";
import { describe, expect, it } from "vitest";
import { coverage, esc, ranked, renderReportHtml, safeImage } from "./render.ts";

const step = (index: number, extra: Partial<Step> = {}): Step => ({
  index,
  action: "goto /",
  url: "https://shop.test/",
  at: "2026-10-18T00:00:00.000Z",
  screenshot: `step-${String(index).padStart(3, "0")}.png`,
  dom: `step-${String(index).padStart(3, "0")}.html`,
  visibleText: "",
  price: null,
  cart: null,
  dialog: null,
  checkboxes: [],
  links: [],
  ...extra,
});

const run = (steps: Step[], extra: Partial<AuditRun> = {}): AuditRun => ({
  id: "shop-1",
  target: "https://shop.test",
  startedAt: "2026-10-18T00:00:00.000Z",
  finishedAt: "2026-10-18T00:01:00.000Z",
  status: "completed",
  note: null,
  trace: null,
  steps,
  ...extra,
});

const finding = (extra: Partial<Finding> = {}): Finding => ({
  pattern: "drip_pricing",
  status: "likely",
  confidence: 0.9,
  detector: "rule",
  evidenceSteps: [1],
  explanation: "A fee appeared late.",
  ...extra,
});

const render = (r: AuditRun, findings: Finding[], mode: "crawler" | "recorded-session" = "crawler") =>
  renderReportHtml({ run: r, findings, mode, detectors: "rules", generatedAt: "2026-10-18T01:00:00.000Z" });

describe("untrusted input", () => {
  it("escapes markup in everything that came from a page", () => {
    const evil = `<script>alert(1)</script><img src=x onerror=alert(2)>"'&`;
    const html = render(
      run([step(0), step(1, { action: evil, url: `https://shop.test/?q=${evil}` })], { id: evil, target: `https://${evil}` }),
      [finding({ explanation: evil })],
    );
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("only links screenshots the tool itself writes", () => {
    expect(safeImage("step-003.png")).toBe("step-003.png");
    for (const bad of ["../../etc/passwd", "http://evil.test/x.png", "step-3.png", "step-003.png/../x", "javascript:alert(1)", "step-003.svg", ""]) {
      expect(safeImage(bad)).toBeNull();
    }
    const html = render(run([step(0), step(1, { screenshot: "../../secret.png" })]), [finding()]);
    expect(html).not.toContain("secret.png");
    expect(html).toContain("No screenshot");
  });

  it("esc handles every special character", () => {
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("what the report claims", () => {
  it("never calls a company guilty or a practice illegal", () => {
    const html = render(run([step(0), step(1)]), [finding(), finding({ pattern: "nagging", status: "review", confidence: 0.5 })]).toLowerCase();
    expect(html).toContain("potential");
    for (const word of ["illegal", "guilty", "violated the law", "broke the law is"]) expect(html).not.toContain(word);
    expect(html).toContain("not a legal finding");
  });

  it("cites the guideline and the evidence for each finding", () => {
    const html = render(run([step(0), step(1, { action: "click Proceed to checkout" })]), [finding({ evidenceSteps: [1] })]);
    expect(html).toContain("Annexure 1, item 8");
    expect(html).toContain('src="step-001.png"');
    expect(html).toContain("Step 1 · click Proceed to checkout");
    expect(html).toContain("confidence 90%");
  });

  it("lists likely findings before ones that need review, and hides OK ones", () => {
    const order = ranked([
      finding({ pattern: "nagging", status: "review", confidence: 0.95 }),
      finding({ pattern: "false_urgency", status: "likely", confidence: 0.7 }),
      finding({ pattern: "forced_action", status: "ok" }),
      finding({ pattern: "drip_pricing", status: "likely", confidence: 0.9 }),
    ]).map((f) => f.pattern);
    expect(order).toEqual(["drip_pricing", "false_urgency", "nagging"]);
  });

  it("says no findings is not a clean bill of health, and explains what was missed", () => {
    const html = render(run([step(0)]), []);
    expect(html).toContain("No potential dark patterns were found");
    expect(html).toContain("What this audit could not see");
    expect(html).toContain("The cart was never seen");
  });

  it("describes a recorded session differently from the automated shopper", () => {
    expect(render(run([step(0)]), [], "recorded-session")).toContain("DarkScan clicked nothing");
    expect(render(run([step(0)]), [], "crawler")).toContain("obeys robots.txt");
  });
});

describe("coverage", () => {
  const cartStep = step(1, {
    cart: [{ name: "Cable", qty: 1, unitPaise: 29900, addedByAgent: true }],
    price: { lines: [{ label: "Cable", amountPaise: 29900, kind: "item" }], totalPaise: 29900, source: "dom" },
  });

  it("notes a single price summary can't show a fee appearing late", () => {
    expect(coverage(run([step(0), cartStep])).missed.join(" ")).toContain("Only one price summary");
  });

  it("reports what was seen, and an early stop", () => {
    const cov = coverage(run([step(0), cartStep, step(2, { dialog: { text: "Hi", buttons: [], dismissedWith: null } })], { note: "Stopped: needs an account" }));
    expect(cov.saw).toEqual(expect.arrayContaining(["the cart", "popups and their buttons", "order price summaries"]));
    expect(cov.missed.join(" ")).toContain("The audit ended early: Stopped: needs an account");
    expect(cov.missed.join(" ")).not.toContain("The cart was never seen");
  });

  it("says a blocked site tells us nothing about its checkout", () => {
    expect(coverage(run([step(0)], { status: "not_auditable" })).missed.join(" ")).toContain("nothing here says anything");
  });

  it("always names the patterns that can't be tested", () => {
    expect(coverage(run([step(0)])).missed.join(" ")).toMatch(/Subscription trap, SaaS billing, Rogue malware/);
  });
});
