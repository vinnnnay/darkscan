import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addObservation, newSession, runRules, toRun, type Observation, type Session } from "../apps/extension/src/session.ts";

const BASE = "http://localhost:4173";
// Playwright runs from the repository root. Build the extension first: npm run extension
const BUNDLE = join(process.cwd(), "apps/extension/dist/content.js");
test.setTimeout(120_000);

let content = "";
test.beforeAll(async () => {
  content = await readFile(BUNDLE, "utf8");
});

/**
 * Loads the extension the way Chrome would, with the messages it sends to the worker captured
 * instead. This exercises the shipped bundle, not a copy of its logic.
 */
async function watch(page: Page) {
  await page.addInitScript(() => {
    (window as any).__seen = [];
    (window as any).chrome = {
      runtime: { sendMessage: (m: any) => ((window as any).__seen.push(m), Promise.resolve({ ok: true })) },
    };
  });
}

/**
 * Chrome injects on every page load, so each navigation is followed by the same injection. The
 * page's capture array does not survive a navigation, so it is drained here, as the worker would.
 */
async function land(page: Page, sink: Observation[]) {
  await page.addScriptTag({ content });
  await page.waitForTimeout(900);
  await decline(page);
  sink.push(
    ...(await page.evaluate(() => {
      const seen = ((window as any).__seen ?? []) as { type: string; observation: Observation }[];
      (window as any).__seen = [];
      return seen.filter((m) => m.type === "observe").map((m) => m.observation);
    })),
  );
}

/** A shopper says no to the popup before carrying on, and the extension watches them do it. */
async function decline(page: Page) {
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) === 0) return;
  const no = dialog.getByRole("button", { name: /^(no|not now|maybe later|skip|i'm just browsing|continue without)/i });
  // Without a timeout this waits for the whole test budget whenever a second popup covers the first.
  if ((await no.count()) > 0) await no.first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
}

/**
 * DarkBench's newsletter popup comes back fifteen seconds after it is closed, so it can cover a
 * control between one action and the next. A shopper simply closes it again.
 */
async function clickThrough(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await decline(page);
    try {
      await locator.click({ timeout: 8000 });
      return;
    } catch {
      /* the popup returned: close it and try once more */
    }
  }
  throw new Error("could not reach the control past the popups");
}

/** Replays what the content script saw through the worker's logic, as the extension does. */
function audit(all: Observation[]): Session {
  let session = newSession(BASE, "2026-10-19T00:00:00.000Z");
  for (const o of all) session = addObservation(session, o, "2026-10-19T00:00:00.000Z");
  return session;
}

const addToCart = (page: Page) => page.getByRole("button", { name: /add to cart/i });

test("the built content script sees DarkBench's planted patterns while a person shops", async ({ page }) => {
  const seen: Observation[] = [];
  await watch(page);
  await page.goto(`${BASE}/?v=1`);
  await land(page, seen);

  // The headline deal is the bait: it is "Currently unavailable". A shopper goes back and picks
  // another product, which is the behaviour the bait-and-switch pattern is designed to provoke.
  const links = page.locator('a[href*="/product/"]');
  const tries = Math.min(3, await links.count());
  for (let i = 0; i < tries; i++) {
    await clickThrough(page, links.nth(i));
    await land(page, seen);
    if ((await addToCart(page).count()) > 0) break;
    await page.goBack();
    await land(page, seen);
  }
  expect(await addToCart(page).count()).toBeGreaterThan(0);

  // A reload is what lets the countdown be compared against itself.
  await page.reload();
  await land(page, seen);

  await clickThrough(page, addToCart(page).first());
  await page.waitForTimeout(900);

  for (const path of ["/cart/", "/checkout/"]) {
    await page.goto(`${BASE}${path}`);
    await land(page, seen);
  }

  expect(seen.length).toBeGreaterThan(3);

  const session = audit(seen);
  const found = runRules(toRun(session));
  const likely = found.filter((f) => f.status === "likely").map((f) => f.pattern);
  console.log("extension found:", found.map((f) => `${f.pattern}:${f.status}`).join(", ") || "nothing");

  // Planted in variant 1 and visible from the pages a shopper walks through without signing up.
  // Drip pricing is not among them: variant 1 also plants an account wall, which hides the
  // checkout summary, so the late fees cannot be seen. The next test covers that case.
  expect(likely).toContain("nagging");
  expect(likely).toContain("interface_interference");
  expect(likely).toContain("basket_sneaking");
  expect(likely).toContain("forced_action");

  // The popup's buttons must carry the measurements the interference rule compares.
  const popup = session.steps.find((s) => s.dialog !== null)!;
  expect(popup.dialog!.buttons.length).toBeGreaterThan(1);
  expect(popup.dialog!.dismissedWith).toBeTruthy();

  // Nothing of the page itself is kept: no screenshot, no HTML.
  expect(session.steps.every((s) => s.screenshot === "" && s.dom === "")).toBe(true);
});

test("an honest shop produces no findings", async ({ page }) => {
  const seen: Observation[] = [];
  await watch(page);
  for (const path of ["/?v=0", "/cart/", "/checkout/"]) {
    await page.goto(`${BASE}${path}`);
    await land(page, seen);
  }
  const found = runRules(toRun(audit(seen)));
  expect(found.filter((f) => f.status === "likely")).toEqual([]);
});

test("a fee that only appears at checkout is caught on the way through", async ({ page }) => {
  const seen: Observation[] = [];
  await watch(page);
  // Only drip pricing, so no account wall stands between the shopper and the checkout summary.
  await page.goto(`${BASE}/?dp=drip_pricing`);
  await land(page, seen);

  await clickThrough(page, page.locator('a[href*="/product/"]').first());
  await land(page, seen);
  await clickThrough(page, addToCart(page).first());
  await page.waitForTimeout(900);

  for (const path of ["/cart/", "/checkout/"]) {
    await page.goto(`${BASE}${path}`);
    await land(page, seen);
  }
  // Checkout asks how you want to check out first; the order summary is on the other side of it.
  const guest = page.getByRole("button", { name: /guest/i });
  expect(await guest.count()).toBeGreaterThan(0);
  await clickThrough(page, guest.first());
  await land(page, seen);

  const found = runRules(toRun(audit(seen)));
  const drip = found.find((f) => f.pattern === "drip_pricing");
  expect(drip?.status).toBe("likely");
  // The explanation must name the charge, since that is what a person has to check on the page.
  expect(drip?.explanation).toMatch(/fee|tax|gst|convenience|platform/i);
});
