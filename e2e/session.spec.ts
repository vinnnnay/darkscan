import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { chromium } from "playwright";
import { captureStep, chromiumArgs } from "../packages/crawler/src/index.ts";
import { detectAll } from "../packages/detectors/src/index.ts";
import { SessionRecorder } from "../packages/session/src/index.ts";
import { makeRedactor } from "../packages/session/src/redact.ts";

const BASE = "http://localhost:4173";
test.setTimeout(180_000);
// The recorder must keep no trace of its own, and the runner must not trace the browsers it drives.
test.use({ trace: "off" });

const SECRETS = ["S3cretPass!", "asha.verma@example.com", "Asha Verma", "12 MG Road", "560001", "4111 1111 1111 1111"];

/** Pauses like a person would, long enough for the recorder to notice the page and any popup. */
const beat = (page: Page, ms = 1400) => page.waitForTimeout(ms);

/** Clicks "no" on every popup that is open, one at a time, as a person closing them would. */
async function declinePopups(page: Page) {
  for (let i = 0; i < 4; i++) {
    // The popup opened last is on top, and it is the only one a person can click.
    const button = page.locator('[role="dialog"]').last().locator("button").filter({ hasText: /no thanks|i hate saving|not now|risk breaking/i }).first();
    if ((await button.count()) === 0) return;
    await button.click();
    await beat(page, 900);
  }
}

test("records a person shopping, finds the dark patterns, keeps their secrets off disk, and stops at payment", async ({}, info) => {
  const browser = await chromium.launch({ args: chromiumArgs() });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000); // a stuck action should fail fast and say which one
  const recorder = await SessionRecorder.attach(context, page, {
    outDir: info.outputPath(),
    site: "human",
    startUrl: BASE,
    redact: ["Asha Verma", "12 MG Road"],
    settleMs: 450,
    pollMs: 250,
    log: (line) => console.log(`   recorder: ${line}`),
  });

  // --- the person shops
  await page.goto(`${BASE}/?v=1`);
  await beat(page);
  await declinePopups(page);
  await page.getByRole("link", { name: /Mega deal/ }).click();
  await beat(page);
  await declinePopups(page);
  await page.goto(`${BASE}/product/usb-cable/`);
  await beat(page);
  await declinePopups(page);
  await page.waitForTimeout(2600); // reads the page while the "deal" timer runs
  await page.reload();
  await beat(page);
  await declinePopups(page);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await beat(page);
  await declinePopups(page);
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await beat(page);
  await declinePopups(page);

  // forced to create an account: they type a password and an email
  await page.getByPlaceholder("Email").fill("asha.verma@example.com");
  await page.getByPlaceholder("Password").fill("S3cretPass!");
  await page.getByRole("button", { name: "Create account" }).click();
  await beat(page);
  await declinePopups(page);

  // address form: name, address, PIN, and a card number typed into the wrong box
  await page.getByPlaceholder("Full name").fill("Asha Verma");
  await page.getByPlaceholder("Address").fill("12 MG Road");
  await page.getByPlaceholder("PIN code").fill("560001");
  await page.getByPlaceholder("PIN code").fill("560001 4111 1111 1111 1111");
  await page.getByPlaceholder("PIN code").fill("560001");
  await beat(page, 800);
  await page.getByRole("link", { name: "Proceed to payment" }).click();
  await beat(page, 1800);

  // after payment is reached, nothing more is recorded
  const stepsAtPayment = recorder.run.steps.length;
  await page.goto(`${BASE}/`);
  await beat(page);
  const run = await recorder.finish();
  await browser.close();

  // --- it saw the patterns, from a person's clicks alone
  const found = new Set(detectAll(run).filter((f) => f.status === "likely").map((f) => f.pattern));
  for (const pattern of ["false_urgency", "nagging", "interface_interference", "forced_action", "basket_sneaking", "drip_pricing", "bait_and_switch"] as const) {
    expect(found, `expected ${pattern}; saw ${[...found].join(", ")}`).toContain(pattern);
  }
  expect(run.steps.some((s) => s.action === "reload")).toBe(true);
  expect(run.steps.some((s) => s.dialog?.dismissedWith)).toBe(true);

  // --- it stopped at payment, and saved nothing from that page
  expect(run.steps).toHaveLength(stepsAtPayment);
  const last = run.steps.at(-1)!;
  expect(last.action).toBe("payment page reached: recording stopped");
  expect(last.screenshot).toBe("");
  expect(last.visibleText).toBe("");
  expect(run.note).toMatch(/stopped at a payment page/);

  // --- nothing typed, and nothing the person asked to hide, reached the disk
  const files = await readdir(recorder.folder);
  expect(files).not.toContain("trace.zip");
  expect(run.trace).toBeNull();
  for (const file of files.filter((f) => /\.(json|html)$/.test(f))) {
    const text = await readFile(join(recorder.folder, file), "utf8");
    for (const secret of SECRETS) expect(text, `${file} leaks "${secret}"`).not.toContain(secret);
    expect(text).not.toMatch(/<script/i);
  }
});

test("a value typed into a field is hidden in the screenshot, and visible again for the person afterwards", async ({ page }, info) => {
  const markup = `<body style="margin:20px"><input id="f" style="font:48px sans-serif;width:520px" placeholder=""></body>`;
  const shot = async (type: boolean) => {
    await page.setContent(markup);
    if (type) await page.locator("#f").fill("TOPSECRET");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const step = await captureStep(page, {
      dir: info.outputPath(),
      index: type ? 1 : 0,
      action: "x",
      dialog: null,
      claimed: [],
      privacy: { redact: makeRedactor(), screenshots: true },
    });
    return readFile(join(info.outputPath(), step.screenshot));
  };
  const typed = await shot(true);
  const empty = await shot(false);
  expect(typed.equals(empty)).toBe(true); // identical pixels: the typed text is not in the picture

  await page.setContent(markup);
  await page.locator("#f").fill("TOPSECRET");
  await captureStep(page, { dir: info.outputPath(), index: 2, action: "x", dialog: null, claimed: [], privacy: { redact: makeRedactor(), screenshots: true } });
  const colour = await page.locator("#f").evaluate((el) => getComputedStyle(el).color);
  expect(colour).not.toBe("rgba(0, 0, 0, 0)"); // the person can see what they type again
  expect(await page.locator("#f").inputValue()).toBe("TOPSECRET"); // and nothing was changed
});

test("saved pages have no scripts and no field values", async ({ page }, info) => {
  await page.setContent(`
    <script>window.token = "tok_live_abc123"</script>
    <input value="typed-in-input"><textarea>typed-in-textarea</textarea>
    <select><option selected>chosen-option</option></select><h1>Checkout</h1>`);
  const step = await captureStep(page, {
    dir: info.outputPath(),
    index: 0,
    action: "x",
    dialog: null,
    claimed: [],
    privacy: { redact: makeRedactor(), screenshots: false },
  });
  const html = await readFile(join(info.outputPath(), step.dom), "utf8");
  for (const leak of ["tok_live_abc123", "typed-in-input", "typed-in-textarea"]) expect(html).not.toContain(leak);
  expect(html).toContain("Checkout");
  expect(step.screenshot).toBe(""); // screenshots off
});

test("a link that opens in a new tab is followed", async ({}, info) => {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/b" ? "<h1>Second tab</h1>" : `<h1>Shop</h1><a href="/b" target="_blank">Open product</a>`);
  }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ args: chromiumArgs() });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const recorder = await SessionRecorder.attach(context, page, { outDir: info.outputPath(), site: "tabs", startUrl: base, settleMs: 400, pollMs: 250 });
    await page.goto(base);
    await beat(page, 1000);
    await page.getByRole("link", { name: "Open product" }).click();
    await page.waitForTimeout(1800);
    const run = await recorder.finish();
    expect(run.steps.map((s) => s.url)).toContain(`${base}/b`);
    expect(run.steps.find((s) => s.url === `${base}/b`)!.visibleText).toContain("Second tab");
  } finally {
    await browser.close();
    server.close();
  }
});
