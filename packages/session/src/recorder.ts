import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyPage, observePage } from "@darkscan/agent";
import { captureStep, chooseDecline, describeDialog, openDialogText, type Privacy } from "@darkscan/crawler";
import { AuditRunSchema, type AuditRun, type Dialog } from "@darkscan/schema";
import type { BrowserContext, Page } from "playwright";
import { makeRedactor } from "./redact.ts";

export type RecorderOptions = {
  /** Parent folder; the session is written to <outDir>/<run id>/. */
  outDir: string;
  site: string;
  startUrl: string;
  /** Words to mask wherever they appear: the person's own name, phone number, address. */
  redact?: readonly string[];
  /** Take screenshots (typed values are hidden in them either way). */
  screenshots?: boolean;
  /** How long a page must be quiet after a click or navigation before it is recorded. */
  settleMs?: number;
  /** How often to look for a popup that has opened. */
  pollMs?: number;
  log?: (line: string) => void;
};

type ClickInfo = { text: string; title: string };

const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const ADD = /add to (cart|bag|basket|trolley)/i;

/**
 * Runs inside every page the person opens. It only reports what was clicked (the label of a button or
 * link, and the page's heading); it never reads what is typed into a field, and it never clicks anything.
 */
function installClickListener() {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Typing is not a step, and a typed value must never be read.
      if (target.matches("input:not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select")) return;
      const el = target.closest("a, button, [role=button], label, input, [onclick]") ?? target;
      const input = el as HTMLInputElement;
      const label = ["submit", "button"].includes(input.type) ? input.value : "";
      const text = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || label || el.closest("label")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      const title = (document.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      (window as unknown as { __darkscanClick?: (info: ClickInfo) => void }).__darkscanClick?.({ text, title });
    },
    true,
  );
}

/**
 * Records a shopping session that a PERSON is driving, in their own browser window. It listens: after a
 * page loads, a click settles or a popup opens, it captures the same evidence the automated shopper does.
 *
 * Built to protect that person. Typed values are hidden in screenshots and removed from saved pages;
 * emails, phone and card numbers (and any words they list) are masked; no browser trace is kept; and
 * recording stops the moment a payment page or overlay appears, without capturing it.
 */
export class SessionRecorder {
  readonly run: AuditRun;
  private dir: string;
  private options: RecorderOptions;
  private privacy: Privacy;
  private redact: (text: string) => string;
  /** Products the person put in the cart on purpose, to tell them from sneaked ones. */
  private claimed: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  private settle: ReturnType<typeof setTimeout> | null = null;
  private pending: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private active: Page | null = null;
  private lastDialog: string | null = null;
  private done = false;
  /** Why recording stopped early, if it did. */
  stopReason: string | null = null;

  private constructor(options: RecorderOptions, dir: string, run: AuditRun) {
    this.options = options;
    this.dir = dir;
    this.run = run;
    this.redact = makeRedactor(options.redact);
    this.privacy = { redact: this.redact, screenshots: options.screenshots ?? true };
  }

  static async attach(context: BrowserContext, first: Page, options: RecorderOptions): Promise<SessionRecorder> {
    const startedAt = new Date();
    const id = `${options.site}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const dir = join(options.outDir, id);
    await mkdir(dir, { recursive: true });
    const run: AuditRun = {
      id,
      target: new URL(options.startUrl).origin,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: "running",
      note: null,
      // No Playwright trace on purpose: it keeps the whole page, typed values included.
      trace: null,
      steps: [],
    };
    const recorder = new SessionRecorder(options, dir, run);

    await context.exposeBinding("__darkscanClick", (source, info: ClickInfo) => recorder.onClick(source.page, info));
    await context.addInitScript(installClickListener);
    context.on("page", (page) => {
      recorder.watch(page);
      // A new tab is an event in itself: its first load may happen before we can listen for it.
      recorder.schedule(page, null);
    });
    recorder.watch(first);
    recorder.pollTimer = setInterval(() => recorder.poll(), options.pollMs ?? 600);
    return recorder;
  }

  private watch(page: Page) {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.schedule(page, null);
    });
  }

  private onClick(page: Page, info: ClickInfo) {
    if (this.stopReason || this.done) return;
    // Only the label of what was clicked is kept, and it is masked like everything else.
    if (ADD.test(info.text)) this.claimed.push(this.redact(info.title || info.text));
    this.schedule(page, info.text ? `click ${this.redact(info.text)}` : "click");
  }

  /** Waits for the page to go quiet, then records it once, however many events arrived. */
  private schedule(page: Page, action: string | null) {
    if (this.stopReason || this.done) return;
    this.active = page;
    if (action) this.pending = action;
    else this.pending ??= "navigate";
    if (this.settle) clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      const label = this.pending ?? "navigate";
      this.pending = null;
      this.settle = null;
      this.enqueue(() => this.captureCurrent(page, label));
    }, this.options.settleMs ?? 900);
  }

  private enqueue(task: () => Promise<void>) {
    this.chain = this.chain.then(task).catch((error) => this.options.log?.(`skipped a capture: ${error instanceof Error ? error.message : String(error)}`));
    return this.chain;
  }

  private async captureCurrent(page: Page, action: string) {
    if (this.stopReason || page.isClosed()) return;
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    const facts = await page.evaluate(observePage).catch(() => null);
    if (!facts) return;
    // Checked before anything is captured, so nothing from a payment page is ever saved.
    if (classifyPage(facts) === "payment") return this.stopAtPayment(facts.url);

    let label = action;
    if (label === "navigate") {
      const kind = await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "navigate");
      label = kind === "reload" ? "reload" : `goto ${this.redact(new URL(facts.url).pathname)}`;
    }
    await this.push(page, label, null);
  }

  /** Looks for a popup that has just opened and records it, with the button the shopper would press to decline. */
  private poll() {
    if (this.stopReason || this.done || this.polling) return;
    this.polling = true;
    void this.enqueue(async () => {
      try {
        const page = this.active;
        if (!page || page.isClosed()) return;
        const text = await page.evaluate(openDialogText).catch(() => null);
        if (text === null) {
          this.lastDialog = null;
          return;
        }
        const key = text.slice(0, 200);
        if (key === this.lastDialog) return;
        this.lastDialog = key;
        const facts = await page.evaluate(observePage).catch(() => null);
        if (facts && classifyPage(facts) === "payment") return this.stopAtPayment(facts.url);
        const info = await page.locator(DIALOGS).last().evaluate(describeDialog).catch(() => null);
        if (!info) return;
        const dialog: Dialog = { ...info, dismissedWith: chooseDecline(info.buttons)?.text ?? null };
        await this.push(page, "popup shown", dialog);
      } finally {
        this.polling = false;
      }
    });
  }

  private async push(page: Page, action: string, dialog: Dialog | null) {
    const step = await captureStep(page, {
      dir: this.dir,
      index: this.run.steps.length,
      action,
      dialog,
      claimed: this.claimed,
      privacy: this.privacy,
    });
    this.run.steps.push(step);
    this.options.log?.(`recorded step ${step.index}: ${step.action}`);
  }

  /** Records that payment was reached, with nothing from the page, and stops listening for good. */
  private stopAtPayment(url: string) {
    this.stopReason = "Recording stopped at a payment page, as designed. Nothing after this point was saved.";
    this.run.steps.push({
      index: this.run.steps.length,
      action: "payment page reached: recording stopped",
      url: this.redact(url.split("?")[0]!.split("#")[0]!),
      at: new Date().toISOString(),
      screenshot: "",
      dom: "",
      visibleText: "",
      price: null,
      cart: null,
      dialog: null,
      checkboxes: [],
      links: [],
    });
    this.options.log?.(this.stopReason);
  }

  /** Records what is still pending, writes run.json, and stops listening. */
  async finish(): Promise<AuditRun> {
    if (this.done) return this.run;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.settle && this.active) {
      clearTimeout(this.settle);
      const label = this.pending ?? "navigate";
      this.pending = null;
      this.settle = null;
      void this.enqueue(() => this.captureCurrent(this.active!, label));
    }
    await this.chain;
    this.done = true;
    this.run.status = "completed";
    this.run.note = this.stopReason;
    this.run.finishedAt = new Date().toISOString();
    await writeFile(join(this.dir, "run.json"), JSON.stringify(AuditRunSchema.parse(this.run), null, 2));
    return this.run;
  }

  /** The folder holding run.json and the screenshots. */
  get folder(): string {
    return this.dir;
  }
}
