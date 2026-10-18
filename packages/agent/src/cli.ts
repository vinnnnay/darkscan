// Usage:
//   npm run learn -- --url http://localhost:4173/?v=1 --site demo [--llm] [--save recipes] [--headed]
//   npm run audit -- --recipe recipes/demo.json [--llm] [--save recipes]
//
// `learn` explores a site from its start page to checkout and saves the path as a recipe.
// `audit` replays a recipe, runs the detectors on the evidence, and repairs the recipe if the site changed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { recipeFromJson, recipeToJson, type Recipe } from "@darkscan/crawler";
import { DEFAULT_MODEL, detectAll, detectWithLlm, ollama, ollamaReady } from "@darkscan/detectors";
import { writeReport } from "@darkscan/report";
import type { AuditRun } from "@darkscan/schema";
import { auditWithRepair, learnRecipe, type AgentConfig, type Exploration } from "./agent.ts";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    url: { type: "string" },
    site: { type: "string" },
    recipe: { type: "string" },
    save: { type: "string", default: "recipes" },
    out: { type: "string", default: "runs" },
    delay: { type: "string" },
    llm: { type: "boolean", default: false },
    model: { type: "string", default: DEFAULT_MODEL },
    headed: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
const root = resolve(import.meta.dirname, "../../..");
const outDir = resolve(cwd, values.out);
const isLocal = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);

if (values.llm && !(await ollamaReady(values.model))) {
  console.error(`Ollama isn't running or ${values.model} isn't pulled. Run: ollama pull ${values.model}`);
  process.exit(1);
}
const llm = values.llm ? ollama({ model: values.model, cacheDir: join(root, ".cache", "llm") }) : undefined;
const config: AgentConfig = { ...(llm ? { llm } : {}), ...(values.verbose ? { log: (line: string) => console.log(`  · ${line}`) } : {}) };

function options(url: string) {
  // Real sites get a few seconds between actions; the local test shop doesn't need it.
  const politeDelayMs = values.delay !== undefined ? Number(values.delay) : isLocal(url) ? 0 : 2500;
  return { outDir, headless: !values.headed, politeDelayMs, allowAccountCreation: false };
}

function printTrail(recipe: Recipe, run: AuditRun, exploration: Exploration | null) {
  console.log(`\n${run.status}${run.note ? `: ${run.note}` : ""}`);
  for (const step of recipe.steps) {
    const what = step.do === "click" || step.do === "fill" ? JSON.stringify(step.target) : step.do === "goto" ? step.path : step.do === "wait" ? `${step.ms}ms` : "";
    console.log(`  ${step.do.padEnd(6)} ${what}${step.why ? `   (${step.why})` : ""}`);
  }
  if (exploration) {
    console.log(`\nEnded on a ${exploration.reached ?? "unknown"} page. Goal reached: ${exploration.reachedGoal}. Model decisions: ${exploration.modelCalls}.`);
    console.log(`Stop reason: ${exploration.stop}`);
  }
  console.log(`Evidence: ${resolve(outDir, run.id)}`);
}

/** Runs the detectors on a run and leaves report.html and findings.json next to its screenshots. */
async function analyse(run: AuditRun) {
  const findings = llm ? await detectWithLlm(run, llm) : detectAll(run);
  const report = await writeReport(resolve(outDir, run.id), run, findings, { mode: "crawler", detectors: llm ? `rules + ${llm.model}` : "rules" });
  console.log(`\nFindings (${findings.length}):`);
  for (const f of findings) console.log(`  [${f.status}] ${f.pattern} (${Math.round(f.confidence * 100)}%): ${f.explanation}`);
  console.log(`Report: ${report}`);
}

async function saveRecipe(recipe: Recipe) {
  const dir = resolve(cwd, values.save);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${recipe.site}.json`);
  await writeFile(file, recipeToJson(recipe));
  console.log(`Recipe saved: ${file}`);
}

if (command === "learn") {
  if (!values.url || !values.site) throw new Error("learn needs --url and --site");
  const { recipe, run, exploration } = await learnRecipe(values.site, values.url, options(values.url), config);
  printTrail(recipe, run, exploration);
  if (run.steps.length > 0) await analyse(run);
  if (exploration.reachedGoal) await saveRecipe(recipe);
  else console.log("Goal not reached, so no recipe was saved.");
  process.exitCode = exploration.reachedGoal ? 0 : 1;
} else if (command === "audit") {
  if (!values.recipe) throw new Error("audit needs --recipe");
  const recipe = recipeFromJson(await readFile(resolve(cwd, values.recipe), "utf8"));
  const result = await auditWithRepair(recipe, options(recipe.baseUrl), config);
  printTrail(result.recipe, result.run, result.exploration);
  if (result.run.steps.length > 0) await analyse(result.run);
  if (result.repaired) await saveRecipe(result.recipe);
} else {
  console.error("Usage: cli.ts learn|audit (see the header of this file)");
  process.exitCode = 2;
}
