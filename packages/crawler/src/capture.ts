import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StepSchema, type Dialog, type Step } from "@darkscan/schema";
import type { Page } from "playwright";
import { cartRowTexts, hideTypedValues, sanitizedHtml, showTypedValues, summaryText, visibleCheckboxes, visibleLinks } from "./collect.ts";
import { parseCartRows, parsePriceText } from "./extract.ts";

/** How to protect the person behind a recorded session. The automated crawler uses none of this. */
export type Privacy = {
  /** Masks private values (emails, phone and card numbers, the person's own words) in any text that is saved. */
  redact: (text: string) => string;
  /** Take screenshots at all. Typed values are hidden in them either way. */
  screenshots: boolean;
};

export type CaptureOptions = {
  /** The run's folder: screenshots and saved pages go here. */
  dir: string;
  index: number;
  action: string;
  dialog: Dialog | null;
  /** Products that were put in the cart on purpose (by the crawler, or by the person), to tell them from sneaked ones. */
  claimed: readonly string[];
  privacy?: Privacy;
};

/**
 * Records what the page shows right now: a screenshot, the saved page, the visible text,
 * prices, cart, checkboxes and links. One step of an audit, whoever is driving the browser.
 */
export async function captureStep(page: Page, o: CaptureOptions): Promise<Step> {
  const { privacy } = o;
  const name = `step-${String(o.index).padStart(3, "0")}`;
  const redact = privacy?.redact ?? ((text: string) => text);

  let screenshot = "";
  if (!privacy || privacy.screenshots) {
    if (privacy) await page.evaluate(hideTypedValues);
    try {
      await page.screenshot({ path: join(o.dir, `${name}.png`), fullPage: true });
      screenshot = `${name}.png`;
    } finally {
      if (privacy) await page.evaluate(showTypedValues).catch(() => {});
    }
  }
  await writeFile(join(o.dir, `${name}.html`), privacy ? redact(await page.evaluate(sanitizedHtml)) : await page.content());

  const [visibleText, summary, rows, checkboxes, links] = await Promise.all([
    page.evaluate(() => document.body.innerText),
    page.evaluate(summaryText),
    page.evaluate(cartRowTexts),
    page.evaluate(visibleCheckboxes),
    page.evaluate(visibleLinks),
  ]);

  const url = privacy ? redact(page.url().split("#")[0]!) : page.url();
  return StepSchema.parse({
    index: o.index,
    action: o.action,
    url,
    at: new Date().toISOString(),
    screenshot,
    dom: `${name}.html`,
    visibleText: redact(visibleText),
    price: parsePriceText(summary),
    cart: rows.length ? parseCartRows(rows.map(redact), o.claimed) : null,
    dialog: o.dialog && privacy ? { ...o.dialog, text: redact(o.dialog.text) } : o.dialog,
    checkboxes: checkboxes.map((box) => ({ ...box, label: redact(box.label) })),
    links: links.map((link) => ({ text: redact(link.text), href: redact(link.href) })),
  });
}
