import {
  AuditSession,
  NotAuditable,
  StopAudit,
  TargetNotFound,
  type AuditOptions,
  type Recipe,
  type RecipeStep,
  type Target,
} from "@darkscan/crawler";
import type { AuditRun } from "@darkscan/schema";
import type { Llm } from "@darkscan/detectors";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { observePage, type Candidate, type PageFacts } from "./observe.ts";
import { GOAL_KINDS, classifyPage, decide, failedKey, findAdvertisedDeal, identity, shortlist, variantKey, type Choice, type PageKind } from "./policy.ts";

export type AgentConfig = {
  /** Asked to pick a control when no rule fits. Without it, the agent stops when the rules run out. */
  llm?: Llm;
  /** Most actions the agent may take before giving up. */
  maxActions?: number;
  /** Click the headline deal first, then come back: tests whether the advertised offer is real. */
  probeAdvertisedDeal?: boolean;
  /** On the first product page, wait and reload: tests whether a countdown restarts. */
  probeFalseUrgency?: boolean;
  /** Called with one line per decision, to see why the agent did what it did. */
  log?: (line: string) => void;
};

export type Exploration = {
  steps: RecipeStep[];
  /** The kind of page the agent ended on. */
  reached: PageKind | null;
  /** True when it ended on a checkout form, account wall or payment page, which is the goal. */
  reachedGoal: boolean;
  stop: string;
  /** StopAudit, NotAuditable or a crash raised while acting: the caller decides what it means. */
  error: unknown;
  /** How many decisions the model had to make because no rule fit. */
  modelCalls: number;
};

const DEFAULTS = { maxActions: 14, probeAdvertisedDeal: true, probeFalseUrgency: true } as const;

/** A click target that survives page changes: link cards by URL, everything else by role and name. */
export function targetFor(c: Candidate): Target {
  // Only real web links can be found again by URL; "javascript:void(0)" matches every such link on the page.
  const web = c.href !== null && /^https?:$/.test(new URL(c.href).protocol);
  if (web && c.kind !== "button" && (c.hasPrice || c.text.length > 40)) {
    const url = new URL(c.href!);
    return { href: url.pathname + url.search };
  }
  // A div that says "ADD TO CART" has no button role to find it by, only its label.
  if (c.kind === "label") return { text: c.text, exact: true };
  // A card with no link is clicked by its title text, which sits inside the clickable block.
  if (c.kind === "card") return { text: c.text.replace(/\s*(₹|rs\.?|inr)\s*[\d,.]+.*$/i, "").trim().slice(0, 60) };
  // Counts like "Cart (2)", "1 Cart" or "Cart 3" change from run to run, and a badge may not be part of the
  // control's accessible name at all, so leave them out.
  const name = c.text.replace(/\s*\(\d+\)\s*/g, " ").replace(/^\d+\s+|\s+\d+$/g, "").trim().slice(0, 60);
  return { role: c.kind === "link" ? "link" : "button", name };
}

/** A click that failed because the control isn't reachable. Stops, bot checks and crashes are not this. */
function isUnclickable(error: unknown): boolean {
  if (error instanceof StopAudit || error instanceof NotAuditable) return false;
  if (error instanceof TargetNotFound) return true;
  return error instanceof Error && /Timeout \d+ms exceeded|intercepts pointer events|not visible|detached from the DOM/i.test(error.message);
}

const State = Annotation.Root({
  facts: Annotation<PageFacts | null>(),
  kind: Annotation<PageKind | null>(),
  choice: Annotation<Choice | null>(),
  steps: Annotation<RecipeStep[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  addedToCart: Annotation<boolean>(),
  probedDeal: Annotation<boolean>(),
  probedUrgency: Annotation<boolean>(),
  actions: Annotation<number>(),
  modelCalls: Annotation<number>(),
  seen: Annotation<string[]>(),
  /** Paths of links already clicked, so a dead end isn't tried twice. */
  clicked: Annotation<string[]>(),
  lastRole: Annotation<string | null>(),
  stop: Annotation<string | null>(),
  error: Annotation<unknown>(),
});

/**
 * Explores from the page the session is on to checkout, recording each action as a recipe
 * step. A LangGraph loop: observe the page, decide (rules first, the model only when no
 * rule fits), act through the audit session, repeat until a goal page or a limit.
 */
export async function explore(session: AuditSession, startPath: string, config: AgentConfig = {}): Promise<Exploration> {
  const cfg = { ...DEFAULTS, ...config };

  const graph = new StateGraph(State)
    .addNode("observe", async () => {
      const facts = await session.page.evaluate(observePage);
      return { facts, kind: classifyPage(facts) };
    })
    .addNode("decide", async (s) => {
      const facts = s.facts!;
      const kind = s.kind!;
      cfg.log?.(
        `page=${kind} added=${s.addedToCart} actions=${s.actions} url=${facts.url.slice(0, 90)} cartRows=${facts.cartRows} candidates=${facts.candidates.length} ` +
          `cartLinks=[${facts.candidates.filter((c) => /cart|bag/i.test(c.text)).map((c) => `${c.kind}:${c.text}`).join(" | ")}]`,
      );
      // Goal pages end the exploration, but an account wall with a guest option is not a dead end.
      const rule = decide(kind, facts, { addedToCart: s.addedToCart, avoid: new Set(s.clicked) });
      if (rule && "stop" in rule) return { stop: rule.stop, choice: null };
      if (s.actions >= cfg.maxActions) return { stop: `Gave up after ${cfg.maxActions} actions.`, choice: null };

      // A product page with nothing to buy (out of stock, say) is a dead end: go back and try another.
      const away = new URL(facts.url).pathname + new URL(facts.url).search !== startPath;
      if (kind === "listing" && away && s.lastRole === "product") {
        return { choice: { role: "back", why: "that page had nothing to buy, so try another product" } satisfies Choice, lastRole: "back" };
      }

      if (kind === "listing" && cfg.probeAdvertisedDeal && !s.probedDeal) {
        const deal = findAdvertisedDeal(facts);
        if (deal) return { choice: { role: "promo", candidate: deal, why: "test the advertised deal" } satisfies Choice, probedDeal: true };
        return { ...(await pick(s)), probedDeal: true };
      }
      if (kind === "product" && cfg.probeFalseUrgency && !s.probedUrgency && !s.addedToCart) {
        return { choice: { role: "urgency-probe", why: "check whether any countdown restarts on reload" } satisfies Choice, probedUrgency: true };
      }
      return pick(s);
    })
    .addNode("act", async (s) => {
      const choice = s.choice!;
      const done: RecipeStep[] = [];
      const run = async (step: RecipeStep) => {
        await session.perform(step);
        done.push(step);
      };
      // How this action is remembered, so a control that fails isn't tried again.
      const remembered = "candidate" in choice ? identity(choice.candidate) : choice.role === "variant" ? variantKey(choice.option) : null;
      try {
        if ("candidate" in choice) {
          const { candidate, why, role } = choice;
          const adds = role === "add" ? s.facts!.heading || candidate.text : undefined;
          await run({ do: "click", target: targetFor(candidate), why, ...(adds ? { adds } : {}) });
          if (role === "promo") await run({ do: "goto", path: startPath, why: "back to the start after testing the deal" });
        } else if (choice.role === "variant") {
          await run({ do: "click", target: { text: choice.option, exact: true }, why: choice.why });
        } else if (choice.role === "back") {
          await run({ do: "goto", path: startPath, why: choice.why });
        } else {
          await run({ do: "wait", ms: 2500, why: "let any countdown tick" });
          await run({ do: "reload", why: "check whether urgency timers restart" });
        }
      } catch (error) {
        // A control that can't be clicked (covered by a banner, gone, hidden) is a reason to try another, not to give up.
        // Real stops, like a payment control or a bot check, still end the run.
        if (isUnclickable(error) && remembered) {
          const failed = "candidate" in choice ? [remembered, failedKey(s.facts!.url, choice.candidate)] : [remembered];
          return { steps: done, clicked: [...s.clicked, ...failed], seen: [...s.seen, `${s.kind}|${s.facts!.url}|unclickable|${remembered}`], actions: s.actions + 1, lastRole: choice.role };
        }
        return { steps: done, error, stop: error instanceof Error ? error.message : String(error) };
      }
      const candidate = "candidate" in choice ? choice.candidate : null;
      const key = `${s.kind}|${s.facts!.url}|${candidate ? candidate.text : choice.role}`;
      if (candidate && s.seen.includes(key)) return { steps: done, stop: "Stuck: repeated the same action on the same page." };
      const path = remembered;
      return {
        steps: done,
        seen: [...s.seen, key],
        clicked: path ? [...s.clicked, path] : s.clicked,
        lastRole: choice.role,
        actions: s.actions + 1,
        addedToCart: s.addedToCart || choice.role === "add",
      };
    })
    .addEdge(START, "observe")
    .addEdge("observe", "decide")
    .addConditionalEdges("decide", (s) => (s.stop || !s.choice ? END : "act"))
    .addConditionalEdges("act", (s) => (s.stop ? END : "observe"))
    .compile();

  /** Rules first; the model only when none fits. */
  async function pick(s: typeof State.State) {
    const facts = s.facts!;
    const rule = decide(s.kind!, facts, { addedToCart: s.addedToCart, avoid: new Set(s.clicked) });
    if (rule && "stop" in rule) return { stop: rule.stop, choice: null };
    if (rule) return { choice: rule };
    if (!cfg.llm) return { stop: `No rule fits this ${s.kind} page, and no model is available.`, choice: null };
    const answer = await askModel(cfg.llm, s.kind!, facts, s.addedToCart, new Set(s.clicked));
    return { modelCalls: s.modelCalls + 1, ...(answer ? { choice: answer } : { stop: `The model found no suitable control on this ${s.kind} page.`, choice: null }) };
  }

  const initial = {
    facts: null,
    kind: null,
    choice: null,
    steps: [],
    addedToCart: session.run.steps.some((step) => (step.cart?.length ?? 0) > 0),
    probedDeal: false,
    probedUrgency: false,
    actions: 0,
    modelCalls: 0,
    seen: [],
    clicked: [],
    lastRole: null,
    stop: null,
    error: undefined,
  };
  const final = await graph.invoke(initial, { recursionLimit: 100 });
  const reached = final.kind;
  return {
    steps: final.steps,
    reached,
    // A checkout, account or payment page only counts once something has actually been put in the cart.
    reachedGoal: reached !== null && GOAL_KINDS.includes(reached) && final.addedToCart && final.error === undefined,
    stop: final.stop ?? "Finished.",
    error: final.error,
    modelCalls: final.modelCalls,
  };
}

const Pick = z.object({ choice: z.number().int().nullable(), reason: z.string() });

const GOALS: Record<PageKind, (added: boolean) => string> = {
  listing: () =>
    "get to a product: open one product's page if the page shows products; if it shows none, open a product category or " +
    "department that will list products (never a login, account, help, app-download, store-locator or social-media link)",
  product: (added) => (added ? "open the shopping cart" : "add this product to the cart (not 'buy now')"),
  cart: () => "continue to checkout (not payment)",
  account_wall: () => "continue without creating an account",
  checkout: () => "continue",
  payment: () => "continue",
};

async function askModel(llm: Llm, kind: PageKind, facts: PageFacts, added: boolean, avoid: ReadonlySet<string>): Promise<Choice | null> {
  const options = shortlist(facts, avoid);
  if (options.length === 0) return null;
  const list = options.map((c, i) => `[${i}] ${c.kind} "${c.text}"${c.hasPrice ? " (shows a price)" : ""}`).join("\n");
  const verdict = await llm.ask(
    "You guide a shopping-site auditor through checkout. Pick the single control that best achieves the goal. " +
      "Answer with its number, or null if none of the controls does. Never choose anything that pays, orders or signs in.",
    `Goal: ${GOALS[kind](added)}.\nPage: ${facts.title}\n${facts.text.slice(0, 600)}\n\nControls:\n${list}`,
    Pick,
  );
  const candidate = verdict.choice === null ? undefined : options[verdict.choice];
  return candidate ? { role: "llm", candidate, why: `model: ${verdict.reason}` } : null;
}

export type LearnResult = {
  recipe: Recipe;
  run: AuditRun;
  exploration: Exploration;
};

/** Visits `startUrl`, explores to checkout, and returns the recipe it walked plus the evidence run. */
export async function learnRecipe(site: string, startUrl: string, options: AuditOptions, config: AgentConfig = {}): Promise<LearnResult> {
  const start = new URL(startUrl);
  const startPath = start.pathname + start.search;
  const session = await AuditSession.open(site, start.origin, options);
  const steps: RecipeStep[] = [{ do: "goto", path: startPath }];
  let exploration: Exploration | null = null;
  let failure: unknown;
  try {
    await session.perform(steps[0]!);
    exploration = await explore(session, startPath, config);
    steps.push(...exploration.steps);
    failure = exploration.error;
  } catch (error) {
    failure = error;
  }
  const run = await session.finish(failure);
  return {
    recipe: { site, baseUrl: start.origin, steps },
    run,
    exploration: exploration ?? { steps: [], reached: null, reachedGoal: false, stop: String(failure), error: failure, modelCalls: 0 },
  };
}

export type AuditResult = { run: AuditRun; recipe: Recipe; repaired: boolean; exploration: Exploration | null };

/**
 * Replays a recipe. If a step's target has vanished (the site changed), the agent takes over
 * from that page, works out a new path to checkout, and the returned recipe has the repaired tail.
 */
export async function auditWithRepair(recipe: Recipe, options: AuditOptions, config: AgentConfig = {}): Promise<AuditResult> {
  const session = await AuditSession.open(recipe.site, recipe.baseUrl, options);
  let failure: unknown;
  let repaired: Recipe | null = null;
  let exploration: Exploration | null = null;
  let repairedFrom = 0;
  try {
    for (const [i, step] of recipe.steps.entries()) {
      try {
        await session.perform(step);
      } catch (error) {
        if (!(error instanceof TargetNotFound)) throw error;
        const startPath = firstGoto(recipe) ?? "/";
        exploration = await explore(session, startPath, config);
        repairedFrom = i;
        repaired = { ...recipe, steps: [...recipe.steps.slice(0, i), ...exploration.steps] };
        failure = exploration.error;
        break;
      }
    }
  } catch (error) {
    failure = error;
  }
  const run = await session.finish(failure);
  if (repaired) run.note = [run.note, `Recipe repaired from step ${repairedFrom}: ${exploration!.steps.length} step(s) re-learned.`].filter(Boolean).join(" ");
  return { run, recipe: repaired ?? recipe, repaired: repaired !== null, exploration };
}

function firstGoto(recipe: Recipe): string | null {
  const step = recipe.steps.find((s) => s.do === "goto");
  return step && step.do === "goto" ? step.path : null;
}

export { NotAuditable, StopAudit };
