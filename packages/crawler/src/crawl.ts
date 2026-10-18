import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuditRunSchema, type AuditRun, type Dialog } from "@darkscan/schema";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { detectBlock, detectRefusal } from "./block.ts";
import { captureStep } from "./capture.ts";
import { describeDialog } from "./collect.ts";
import { chooseDecline } from "./extract.ts";
import { describeTarget, type Recipe, type RecipeStep, type Target } from "./recipe.ts";
import { RobotsPolicy } from "./robots.ts";

export type AuditOptions = {
  /** Parent folder; the run is written to <outDir>/<run id>/. */
  outDir: string;
  headless?: boolean;
  /** Pause between actions. Keep it at a few seconds for real sites. */
  politeDelayMs?: number;
  /** Lets the recipe fill sign-up forms. Only for DarkBench, never for real sites. */
  allowAccountCreation?: boolean;
  /** Skip pages robots.txt disallows. On by default for every host except localhost. */
  respectRobots?: boolean;
};

/** Buttons the crawler must never press: audits always stop before money moves. */
export const PAYMENT = /\bpay(ment)?\b|place\s+order|confirm\s+order|complete\s+purchase|buy\s+now/i;
const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const USER_AGENT_SUFFIX = "DarkScan/0.1 (consumer-protection research; +https://github.com/vinnnnay/darkscan)";

/** Ends the audit early, normally: the run is kept and the reason is noted. */
export class StopAudit extends Error {}
/** The site shows a bot check or refuses access. We report it and leave. */
export class NotAuditable extends Error {}
/** A recipe step's target isn't on the page. The recipe agent can repair this. */
export class TargetNotFound extends Error {
  readonly step: RecipeStep;
  constructor(step: RecipeStep) {
    super(`Target not found: ${"target" in step ? describeTarget(step.target) : step.do}`);
    this.step = step;
  }
}

const isLocal = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);

/**
 * One browser session that records evidence after every action. A recipe replays through
 * it step by step, and the recipe agent drives it one decision at a time.
 */
export class AuditSession {
  readonly run: AuditRun;
  /** Tabs opened since the last action, newest last. A link that opens in a new tab is followed. */
  readonly newPages: Page[] = [];
  private current: Page;
  /** Set by the robots.txt route when it blocks a navigation. */
  robotsBlocked: string | null = null;
  private browser: Browser;
  private context: BrowserContext;
  private dir: string;
  private baseUrl: string;
  private options: AuditOptions;
  private lastStatus = 200;
  private performed = 0;
  private agentAdded: string[] = [];
  private finished = false;

  private constructor(page: Page, browser: Browser, context: BrowserContext, dir: string, baseUrl: string, options: AuditOptions, run: AuditRun) {
    this.current = page;
    this.browser = browser;
    this.context = context;
    this.dir = dir;
    this.baseUrl = baseUrl;
    this.options = options;
    this.run = run;
  }

  static async open(site: string, baseUrl: string, options: AuditOptions): Promise<AuditSession> {
    const startedAt = new Date();
    const id = `${site}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const dir = join(options.outDir, id);
    await mkdir(dir, { recursive: true });

    const browser = await chromium.launch({ headless: options.headless ?? true });
    // Identify ourselves honestly, on top of a normal browser string so pages render as for a shopper.
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36 ${USER_AGENT_SUFFIX}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-IN", userAgent });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage();

    const run: AuditRun = {
      id,
      target: baseUrl,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      status: "running",
      note: null,
      trace: "trace.zip",
      steps: [],
    };
    const session = new AuditSession(page, browser, context, dir, baseUrl, options, run);

    session.watch(page);
    context.on("page", (opened) => session.newPages.push(opened));
    if (options.respectRobots ?? !isLocal(baseUrl)) {
      const robots = new RobotsPolicy();
      await context.route("**/*", async (route) => {
        const req = route.request();
        // Only top-level navigations are ours to check, not ads or payment widgets in iframes. A new tab's first
        // request is issued before its frame exists, so Playwright can't say which frame it belongs to: that is
        // still a top-level navigation.
        let topLevel = true;
        try {
          topLevel = req.frame().parentFrame() === null;
        } catch {}
        if (req.isNavigationRequest() && topLevel && !(await robots.allowed(req.url()))) {
          session.robotsBlocked = req.url();
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
    }
    return session;
  }

  /** The tab the audit is currently on. A click that opens a new tab moves it there. */
  get page(): Page {
    return this.current;
  }

  /** Tracks the HTTP status of a tab's page loads, to recognise refusals and rate limits. */
  private watch(page: Page) {
    page.on("response", (res) => {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) this.lastStatus = res.status();
    });
  }

  /** If the last click opened a new tab (a product page with target=_blank), carry on there. */
  private async adoptNewTab(): Promise<boolean> {
    const opened = this.newPages.pop();
    this.newPages.length = 0;
    if (!opened) return false;
    await opened.waitForLoadState("domcontentloaded").catch(() => {});
    this.current = opened;
    this.watch(opened);
    return true;
  }

  /** Runs one recipe step, recording evidence. Throws StopAudit, NotAuditable or TargetNotFound. */
  async perform(step: RecipeStep): Promise<void> {
    if (this.performed++ > 0 && this.options.politeDelayMs) await this.page.waitForTimeout(this.options.politeDelayMs);
    const { page } = this;
    switch (step.do) {
      case "goto": {
        const url = new URL(step.path, this.baseUrl).href;
        await page.goto(url).catch((error) => {
          if (this.robotsBlocked) return;
          const refused = detectRefusal(error instanceof Error ? error.message : String(error));
          if (refused) throw new NotAuditable(`Not auditable: ${refused}`);
          throw error;
        });
        await this.afterNavigation(`goto ${step.path}`);
        return;
      }
      case "wait":
        await page.waitForTimeout(step.ms);
        await this.record(`wait ${step.ms}ms`);
        return;
      case "reload":
        await page.reload();
        await this.afterNavigation("reload");
        return;
      case "click":
      case "fill": {
        const target = this.locate(step.target);
        if ((await target.count()) === 0) {
          if (step.optional) return;
          throw new TargetNotFound(step);
        }
        if (step.requiresAccount && !this.options.allowAccountCreation) {
          throw new StopAudit("Stopped: continuing requires creating an account, and audits never sign up.");
        }
        if (step.do === "fill") {
          await target.fill(step.value);
          return;
        }
        const text = ((await target.innerText().catch(() => "")) || describeTarget(step.target)).trim();
        if (PAYMENT.test(text)) throw new StopAudit(`Stopped before payment control: "${text}".`);
        await this.clickThroughPopups(target);
        if (step.adds) this.agentAdded.push(step.adds);
        await this.afterNavigation(`click ${text}`);
        return;
      }
    }
  }

  /** Finishes the run, saves run.json and the trace, closes the browser. Call once. */
  async finish(error?: unknown): Promise<AuditRun> {
    if (this.finished) return this.run;
    this.finished = true;
    const { run } = this;
    if (error === undefined) {
      run.status = "completed";
    } else if (error instanceof StopAudit) {
      run.status = "completed";
      run.note = error.message;
      await this.record("stopped").catch(() => {});
    } else if (error instanceof NotAuditable) {
      run.status = "not_auditable";
      run.note = error.message;
    } else {
      run.status = "failed";
      run.note = error instanceof Error ? error.message : String(error);
    }
    await this.context.tracing.stop({ path: join(this.dir, "trace.zip") });
    await this.browser.close();
    run.finishedAt = new Date().toISOString();
    await writeFile(join(this.dir, "run.json"), JSON.stringify(AuditRunSchema.parse(run), null, 2));
    return run;
  }

  /** Waits for the page, checks it is allowed and not a bot check, clears popups, records. */
  private async afterNavigation(action: string) {
    await this.settle();
    if (await this.adoptNewTab()) await this.settle();
    if (this.robotsBlocked) {
      const url = this.robotsBlocked;
      throw new StopAudit(`Stopped: robots.txt disallows ${url}`);
    }
    // A browser error page is not evidence of anything about the shop. Say so, instead of recording it.
    if (this.page.url().startsWith("chrome-error://")) {
      throw new Error(`The page failed to load after "${action}" (the browser showed its own error page), so nothing was recorded for it.`);
    }
    const text = await this.page.evaluate(() => document.body?.innerText ?? "");
    const blocked = detectBlock(this.lastStatus, text);
    if (blocked) {
      await this.record("blocked").catch(() => {});
      throw new NotAuditable(`Not auditable: ${blocked}`);
    }
    await this.dismissDialogs();
    await this.record(action);
  }

  private async record(action: string, dialog: Dialog | null = null) {
    const { run } = this;
    run.steps.push(await captureStep(this.page, { dir: this.dir, index: run.steps.length, action, dialog, claimed: this.agentAdded }));
  }

  /** Waits for the page to go quiet, so client-rendered popups and prices have appeared. */
  private async settle() {
    await this.page.waitForLoadState("load");
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  /** Records each popup with the button styles, then declines it the way a cautious shopper would. */
  private async dismissDialogs() {
    const { page } = this;
    for (let i = 0; i < 5; i++) {
      // Stacked popups: the one opened last sits on top and blocks clicks on the others.
      const dialog = page.locator(DIALOGS).filter({ visible: true }).last();
      if ((await dialog.count()) === 0) return;
      const info = await dialog.evaluate(describeDialog);
      const decline = chooseDecline(info.buttons);
      await this.record("popup shown", { ...info, dismissedWith: decline?.text ?? null });
      // A popup that won't close must not abort the audit: fall back to Escape, and move on.
      const closer = decline ? dialog.locator("button, a[href], [role=button], input[type=submit]").filter({ hasText: decline.text }).first() : null;
      try {
        if (closer) await closer.click({ timeout: 5000 });
        else await page.keyboard.press("Escape");
      } catch {
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(300);
    }
  }

  private locate(target: Target): Locator {
    const { page } = this;
    const loc =
      "role" in target
        ? page.getByRole(target.role, { name: target.name })
        : "placeholder" in target
          ? page.getByPlaceholder(target.placeholder)
          : "text" in target
            ? // Sites often style "Add To Cart" as uppercase with CSS, so an exact match must ignore case.
              page.getByText(target.exact ? new RegExp(`^\\s*${target.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") : target.text)
            : page.locator(`a[href*=${JSON.stringify(target.href)}]`);
    return loc.filter({ visible: true }).first();
  }

  /** A popup can open between our check and the click; clear it and retry once. */
  private async clickThroughPopups(target: Locator) {
    try {
      await target.click({ timeout: 5000 });
    } catch {
      await this.dismissDialogs();
      await target.click({ timeout: 5000 });
    }
  }
}

/** Replays a recipe from start to finish. */
export async function runAudit(recipe: Recipe, options: AuditOptions): Promise<AuditRun> {
  const session = await AuditSession.open(recipe.site, recipe.baseUrl, options);
  let failure: unknown;
  try {
    for (const step of recipe.steps) await session.perform(step);
  } catch (error) {
    failure = error;
  }
  return session.finish(failure);
}
