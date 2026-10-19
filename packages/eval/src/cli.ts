// Crawls every DarkBench variant, runs the detectors, and scores them against the answer key.
//
//   npm run eval                      rule detectors: write eval/RESULTS.md + eval/results.json
//   npm run eval -- --llm             rules + local language model (Ollama): eval/RESULTS-llm.md
//   npm run eval -- --check           also fail if any pattern drops below the baseline
//   npm run eval -- --update-baseline record the current scores as the new baseline
//   npm run eval -- --variants 0,1,7  only these variants (quick iteration)
//   npm run eval -- --agent           the recipe agent finds the path itself (no hand-written recipe),
//                                     then each learned recipe is replayed to check it is repeatable
//   npm run eval -- --agent --agent-model   also let the local model choose controls when no rule fits
//   npm run eval -- --from runs/eval-…  re-score saved runs without crawling again
//
// Builds nothing: run `npm run build:bench` first. The static server is started if needed.
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { learnRecipe } from "@darkscan/agent";
import { darkbenchRecipe, runAudit, type Recipe } from "@darkscan/crawler";
import { DEFAULT_MODEL, LLM_DETECTORS, RULE_DETECTORS, detectAll, detectWithLlm, ollama, ollamaReady } from "@darkscan/detectors";
import { AuditRunSchema, type AuditRun, type PatternId } from "@darkscan/schema";
import { regressions, score, toMarkdown, type Case, type Split, type SplitBaseline } from "./score.ts";

const { values } = parseArgs({
  options: {
    // DARKBENCH_BASE lets the container point at the bench service without repeating --base.
    base: { type: "string", default: process.env.DARKBENCH_BASE ?? "http://localhost:4173" },
    concurrency: { type: "string", default: "4" },
    variants: { type: "string" },
    from: { type: "string" },
    llm: { type: "boolean", default: false },
    agent: { type: "boolean", default: false },
    "agent-model": { type: "boolean", default: false },
    model: { type: "string", default: DEFAULT_MODEL },
    check: { type: "boolean", default: false },
    "update-baseline": { type: "boolean", default: false },
  },
});

const root = resolve(import.meta.dirname, "../../..");
const evalDir = join(root, "eval");
const suffix = (values.agent ? "-agent" : "") + (values.llm ? "-llm" : "");

type Manifest = { variants: { id: number; split: Split; patterns: PatternId[]; decoys: string[] }[] };
const manifest: Manifest = JSON.parse(await readFile(join(root, "apps/darkbench/public/manifest.json"), "utf8"));
const only = values.variants?.split(",").map(Number);
const variants = manifest.variants.filter((v) => !only || only.includes(v.id));
const patterns = Object.keys({ ...RULE_DETECTORS, ...(values.llm ? LLM_DETECTORS : {}) }) as PatternId[];

if ((values.llm || values["agent-model"]) && !(await ollamaReady(values.model))) {
  console.error(`Ollama isn't running or ${values.model} isn't pulled. Start Ollama and run: ollama pull ${values.model}`);
  process.exit(1);
}
const model = ollama({ model: values.model, cacheDir: join(root, ".cache", "llm") });
const llm = values.llm ? model : null;
const detect = (run: AuditRun) => (llm ? detectWithLlm(run, llm) : Promise.resolve(detectAll(run)));

const runsDir = values.from
  ? resolve(process.env.INIT_CWD ?? process.cwd(), values.from)
  : join(root, "runs", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const learned = new Map<number, { recipe: Recipe; reachedGoal: boolean; stop: string; modelCalls: number }>();
const runs = values.from ? await loadRuns(runsDir) : await crawlAll();

const cases: Case[] = [];
const failed: string[] = [];
let done = 0;
for (const v of variants) {
  const run = runs.get(v.id);
  if (!run) {
    failed.push(`v${v.id}: no run found`);
    continue;
  }
  if (run.status === "failed") failed.push(`v${v.id}: ${run.note}`);
  const findings = await detect(run);
  await writeFile(join(runsDir, run.id, `findings${suffix}.json`), JSON.stringify(findings, null, 2));
  cases.push({ variant: v.id, split: v.split, planted: v.patterns, findings });
  process.stdout.write(`\r  scored ${++done}/${variants.length}`);
}
console.log("\n");

const SPLIT_INFO: Record<Split, string> = {
  dev: "Variants 0–24, wording the detectors may be tuned on.",
  test: "Variants 25–49, held-out wording the detectors are never tuned on.",
};
const splits = (["dev", "test"] as const).filter((split) => cases.some((c) => c.split === split));
const scores = Object.fromEntries(splits.map((split) => [split, score(cases.filter((c) => c.split === split), patterns)]));
const detectors = llm ? `rules + ${llm.model} via Ollama` : "rules only";
const markdown = splits
  .map((split) => {
    const n = cases.filter((c) => c.split === split).length;
    const heading = `## ${split} split (${n} variants)\n\n${SPLIT_INFO[split]} Detectors: ${detectors}. Only "likely" findings count as detections.`;
    return toMarkdown(scores[split]!, heading);
  })
  .join("\n");
console.log(markdown);
const agentReport = values.agent && !values.from ? await reportAgent() : "";
for (const split of splits) {
  for (const s of scores[split]!) {
    if (s.missed.length) console.log(`  [${split}] ${s.pattern} missed in variants ${s.missed.join(", ")}`);
    if (s.falseAlarms.length) console.log(`  [${split}] ${s.pattern} false alarms in variants ${s.falseAlarms.join(", ")}`);
  }
}
if (failed.length) console.log(`\nCrawls that failed:\n  ${failed.join("\n  ")}`);
console.log(`\nRuns and findings: ${runsDir}`);

if (!only) {
  await mkdir(evalDir, { recursive: true });
  await writeFile(join(evalDir, `RESULTS${suffix}.md`), `# DarkBench results (${detectors})\n\n${agentReport}${markdown}`);
  await writeFile(join(evalDir, `results${suffix}.json`), JSON.stringify(scores, null, 2) + "\n");
}

const baselineFile = join(evalDir, `baseline${suffix}.json`);
if (values["update-baseline"]) {
  const baseline: SplitBaseline = Object.fromEntries(
    splits.map((split) => [
      split,
      Object.fromEntries(scores[split]!.map((s) => [s.pattern, { precision: s.precision ?? 1, recall: s.recall ?? 1 }])),
    ]),
  );
  await writeFile(baselineFile, JSON.stringify(baseline, null, 2) + "\n");
  console.log("Baseline updated.");
}

if (values.check) {
  const baseline: SplitBaseline = JSON.parse(await readFile(baselineFile, "utf8"));
  const problems = [
    ...splits.flatMap((split) => regressions(scores[split]!, baseline[split] ?? {}, `[${split}] `)),
    ...failed.map((f) => `crawl failed: ${f}`),
  ];
  if (problems.length) {
    console.error(`\nRegressions:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log("No regressions against the baseline.");
}

/** Runs `fn` over `items` with a small worker pool. */
async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Number(values.concurrency) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
    }),
  );
}

/** Crawls the selected variants: with the hand-written recipe, or (--agent) with a path the agent finds itself. */
async function crawlAll(): Promise<Map<number, AuditRun>> {
  const server = await ensureServer(values.base);
  const out = new Map<number, AuditRun>();
  await pool(variants, async (v) => {
    if (values.agent) {
      // Learning never creates accounts: where checkout demands one, the agent stops, as it must on a real site.
      const r = await learnRecipe(`darkbench-v${v.id}`, `${values.base}/?v=${v.id}`, { outDir: runsDir }, values["agent-model"] ? { llm: model } : {});
      out.set(v.id, r.run);
      learned.set(v.id, { recipe: r.recipe, reachedGoal: r.exploration.reachedGoal, stop: r.exploration.stop, modelCalls: r.exploration.modelCalls });
    } else {
      out.set(v.id, await runAudit(darkbenchRecipe(values.base, v.id), { outDir: runsDir, allowAccountCreation: true }));
    }
    process.stdout.write(`\r  crawled ${out.size}/${variants.length}`);
  });
  server?.kill();
  console.log();
  return out;
}

/** How well the agent did on its own, and whether the recipes it wrote replay to the same findings. */
async function reportAgent(): Promise<string> {
  const server = await ensureServer(values.base);
  const reached = [...learned].filter(([, l]) => l.reachedGoal);
  const stuck = [...learned].filter(([, l]) => !l.reachedGoal).sort(([a], [b]) => a - b);
  const key = (fs: { pattern: string; status: string }[]) => fs.map((f) => `${f.pattern}:${f.status}`).sort().join(",");
  const differing: number[] = [];
  const failedToLoad: number[] = [];
  let replayed = 0;
  await pool(reached, async ([id, l]) => {
    const replay = await runAudit(l.recipe, { outDir: `${runsDir}-replay` });
    // A replay that couldn't load a page is a different problem from one that found different things.
    if (replay.status === "failed") failedToLoad.push(id);
    else if (key(detectAll(replay)) !== key(detectAll(runs.get(id)!))) differing.push(id);
    process.stdout.write(`\r  replayed ${++replayed}/${reached.length}`);
  });
  server?.kill();
  console.log("\n");
  const steps = reached.map(([, l]) => l.recipe.steps.length);
  const lines = [
    `## Recipe agent (${values["agent-model"] ? "rules + model" : "rules only"})`,
    "",
    `- Reached checkout, an account wall or payment, with no hand-written recipe: **${reached.length}/${learned.size}**`,
    `- Recipe length: ${steps.length ? `${Math.min(...steps)}–${Math.max(...steps)} steps` : "n/a"}; model decisions: ${[...learned.values()].reduce((n, l) => n + l.modelCalls, 0)}`,
    `- Recipes that replay to identical findings: **${reached.length - differing.length - failedToLoad.length}/${reached.length}**` +
      (differing.length ? ` (found different things: v${differing.sort((a, b) => a - b).join(", v")})` : "") +
      (failedToLoad.length ? ` (a page failed to load: v${failedToLoad.sort((a, b) => a - b).join(", v")})` : ""),
    ...stuck.map(([id, l]) => `- v${id} did not reach the goal: ${l.stop}`),
    "",
  ];
  const text = lines.join("\n");
  console.log(text);
  return text + "\n";
}

/** Loads run.json files from an earlier eval folder, keyed by variant id. */
async function loadRuns(dir: string): Promise<Map<number, AuditRun>> {
  const out = new Map<number, AuditRun>();
  for (const name of await readdir(dir)) {
    const id = /^darkbench-v(\d+)-/.exec(name)?.[1];
    if (id === undefined) continue;
    out.set(Number(id), AuditRunSchema.parse(JSON.parse(await readFile(join(dir, name, "run.json"), "utf8"))));
  }
  return out;
}

/** Starts the DarkBench static server unless something is already answering at `base`. */
async function ensureServer(base: string) {
  if (await reachable(base)) return null;
  const child = spawn(process.execPath, [join(root, "apps/darkbench/scripts/serve.ts")], {
    env: { ...process.env, PORT: new URL(base).port },
    stdio: "ignore",
  });
  for (let i = 0; i < 50 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 100));
  return child;
}

async function reachable(url: string) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
