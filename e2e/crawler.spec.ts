import { expect, test } from "@playwright/test";
import { darkbenchRecipe, runAudit } from "../packages/crawler/src/index.ts";

const BASE = "http://localhost:4173";
test.setTimeout(120_000);
// The crawler records its own trace; the runner tracing the same contexts would collide with it.
test.use({ trace: "off" });

test("clean variant: same total at cart and checkout, nothing sneaked in", async ({}, info) => {
  const run = await runAudit(darkbenchRecipe(BASE, 0), { outDir: info.outputPath(), allowAccountCreation: true });
  expect(run.status).toBe("completed");

  const totals = run.steps.map((s) => s.price?.totalPaise).filter((t) => t != null);
  expect(new Set(totals)).toEqual(new Set([35800])); // ₹299 + ₹40 delivery + ₹19 platform fee, disclosed upfront

  const last = run.steps.at(-1)!;
  expect(last.cart?.every((c) => c.addedByAgent)).toBe(true);
  expect(last.checkboxes).toEqual([{ label: "Send me offers on WhatsApp", checked: false }]);
  expect(run.steps.filter((s) => s.dialog?.text.includes("newsletter"))).toHaveLength(1);
});

test("all-patterns variant: the evidence for each pattern is captured", async ({}, info) => {
  const run = await runAudit(darkbenchRecipe(BASE, 1), { outDir: info.outputPath(), allowAccountCreation: true });
  expect(run.status).toBe("completed");
  const last = run.steps.at(-1)!;

  // drip pricing: fees absent from the cart total appear at checkout
  const cart = run.steps.find((s) => s.url.endsWith("/cart/") && s.price)!;
  expect(cart.price!.lines.some((l) => l.kind === "fee")).toBe(false);
  expect(last.price!.lines.filter((l) => l.kind === "fee").map((l) => l.label)).toEqual(["Platform fee", "Convenience fee"]);

  // basket sneaking
  expect(last.cart!.filter((c) => !c.addedByAgent).map((c) => c.name)).toEqual(["Purchase Protection"]);

  // nagging + confirm shaming + interface interference
  const newsletters = run.steps.filter((s) => s.dialog?.text.includes("newsletter"));
  expect(newsletters.length).toBeGreaterThan(3);
  const upsell = run.steps.find((s) => s.dialog?.text.includes("Protect your purchase"))!.dialog!;
  expect(upsell.dismissedWith).toBe("No thanks, I'll risk breaking it");
  const [accept, decline] = upsell.buttons;
  expect(accept!.heightPx).toBeGreaterThan(decline!.heightPx * 3);

  // false urgency: timer goes back up after a reload
  const timer = (text: string) => /Deal ends in\s*(\d\d):(\d\d)/.exec(text)!.slice(1).map(Number);
  const [m1, s1] = timer(run.steps.find((s) => s.action.startsWith("wait"))!.visibleText);
  const [m2, s2] = timer(run.steps.find((s) => s.action === "reload")!.visibleText);
  expect(m2! * 60 + s2!).toBeGreaterThan(m1! * 60 + s1!);

  // trick question + bait and switch
  expect(last.checkboxes[0]?.checked).toBe(true);
  expect(run.steps.some((s) => s.visibleText.includes("Currently unavailable"))).toBe(true);
});

test("never signs up unless allowed: forced action stops the audit", async ({}, info) => {
  const run = await runAudit(darkbenchRecipe(BASE, 1), { outDir: info.outputPath() });
  expect(run.status).toBe("completed");
  expect(run.note).toMatch(/requires creating an account/);
  expect(run.steps.at(-1)!.visibleText).toContain("Create an account to continue");
});
