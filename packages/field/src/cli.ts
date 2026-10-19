// Real-site field work: which shops may be audited, and what one run on each one does.
//
//   npm run survey                       fetch every shop's robots.txt → audits/robots.md
//   npm run sweep                        one audit run per shop → audits/sweep.md
//   npm run sweep -- --shops snapdeal,nykaa [--llm] [--delay 2500] [--headed] [--out runs] [--no-save]
//
// A shop whose path completes gets its recipe saved to recipes/<id>.json, so the audit can be
// replayed later with `npm run audit`. --no-save leaves existing recipes alone.
//
// `survey` only fetches robots.txt. `sweep` opens a browser and shops as a guest: it obeys
// robots.txt, waits between actions, never creates an account and stops before any payment.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { recipeToJson } from "@darkscan/crawler";
import { DEFAULT_MODEL, ollama, ollamaReady } from "@darkscan/detectors";
import type { AgentConfig } from "@darkscan/agent";
import { surveyMarkdown, sweepMarkdown, type SweepRow, type SweepTotals } from "./markdown.ts";
import { SHOPS, shopById, type Shop } from "./shops.ts";
import { fetchRobots, surveyShop, type ShopSurvey } from "./survey.ts";
import { auditShop, oneLine, totals, type ShopAudit } from "./sweep.ts";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    shops: { type: "string" },
    out: { type: "string", default: "runs" },
    audits: { type: "string", default: "audits" },
    save: { type: "string", default: "recipes" },
    "no-save": { type: "boolean", default: false },
    render: { type: "boolean", default: false },
    delay: { type: "string", default: "2500" },
    llm: { type: "boolean", default: false },
    model: { type: "string", default: DEFAULT_MODEL },
    headed: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
const root = resolve(import.meta.dirname, "../../..");
const auditsDir = resolve(cwd, values.audits);
const today = new Date().toISOString().slice(0, 10);

function chosen(): Shop[] {
  if (!values.shops) return SHOPS;
  return values.shops.split(",").map((id) => {
    const shop = shopById(id.trim());
    if (!shop) throw new Error(`Unknown shop "${id.trim()}". Known: ${SHOPS.map((s) => s.id).join(", ")}`);
    return shop;
  });
}

async function survey() {
  const shops = chosen();
  const results: ShopSurvey[] = [];
  for (const shop of shops) {
    const result = await surveyShop(shop, fetchRobots);
    results.push(result);
    const blocked = [result.home, ...result.probes].filter((p) => !p.allowed).length;
    console.log(`  ${result.name.padEnd(18)} ${result.verdict.padEnd(12)} ${blocked ? `${blocked} path(s) disallowed` : "all paths allowed"}`);
  }
  await mkdir(auditsDir, { recursive: true });
  await writeFile(join(auditsDir, "robots.md"), surveyMarkdown(results, today));
  await writeFile(join(auditsDir, "robots.json"), JSON.stringify({ date: today, shops: results }, null, 2) + "\n");
  const limited = results.filter((r) => r.verdict !== "crawlable").length;
  console.log(`\n${limited} of ${results.length} shops disallow a cart or checkout path tested.`);
  console.log(`Wrote ${join(auditsDir, "robots.md")}`);
}

/** Rebuilds the write-up from the last sweep's results, so wording changes cost no shop a visit. */
async function render() {
  const file = join(auditsDir, "sweep.json");
  const saved = JSON.parse(await readFile(file, "utf8")) as { date: string; delayMs: number; model: string | null; shops: SweepRow[]; totals: SweepTotals };
  const rows = saved.shops.map((row) => ({ ...row, stop: oneLine(row.stop) }));
  await writeFile(join(auditsDir, "sweep.md"), sweepMarkdown(rows, saved.totals, saved));
  await writeFile(file, JSON.stringify({ ...saved, shops: rows }, null, 2) + "\n");
  console.log(`Rebuilt ${join(auditsDir, "sweep.md")} from ${rows.length} saved results. No shop was visited.`);
}

async function sweep() {
  const shops = chosen();
  if (values.llm && !(await ollamaReady(values.model))) {
    console.error(`Ollama isn't running or ${values.model} isn't pulled. Run: ollama pull ${values.model}`);
    process.exit(1);
  }
  const llm = values.llm ? ollama({ model: values.model, cacheDir: join(root, ".cache", "llm") }) : null;
  const config: AgentConfig = { ...(llm ? { llm } : {}), ...(values.verbose ? { log: (line: string) => console.log(`      · ${line}`) } : {}) };
  const options = {
    outDir: resolve(cwd, values.out),
    headless: !values.headed,
    politeDelayMs: Number(values.delay),
    allowAccountCreation: false,
  };

  const audits: ShopAudit[] = [];
  for (const shop of shops) {
    console.log(`\n${shop.name} (${shop.home})`);
    try {
      const audit = await auditShop(shop, options, config, llm);
      audits.push(audit);
      const { row, findings } = audit;
      console.log(`  ${row.outcome} after ${row.steps} steps${row.reached ? ` on a ${row.reached} page` : ""}: ${row.stop}`);
      // Printed, never committed: one run is not enough to attribute a pattern to a named shop.
      if (findings.length) console.log(`  findings (not published): ${findings.map((f) => `${f.pattern}:${f.status}`).join(", ")}`);
      console.log(`  evidence: ${join(options.outDir, row.runId)}`);
      // A completed path is the artifact that makes a re-audit cheap; a partial one would mislead.
      if (row.outcome === "reached-goal" && !values["no-save"]) {
        const dir = resolve(cwd, values.save);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${shop.id}.json`), recipeToJson(audit.recipe));
        console.log(`  recipe: ${join(dir, `${shop.id}.json`)}`);
      }
    } catch (error) {
      // One shop crashing must not lose the runs already done.
      console.error(`  crashed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (audits.length === 0) throw new Error("No shop produced a run.");

  const rows: SweepRow[] = audits.map((a) => a.row);
  const sums = totals(audits, shops.length);
  // audits/sweep.md stands for one pass over every shop on one day. A subset run would leave a
  // table that looks complete and is not, so it only prints.
  if (shops.length !== SHOPS.length) {
    console.log(`\n${sums.audited}/${sums.shops} audited. Nothing written: the write-up is only regenerated by a full sweep.`);
    return;
  }
  await mkdir(auditsDir, { recursive: true });
  await writeFile(join(auditsDir, "sweep.md"), sweepMarkdown(rows, sums, { date: today, delayMs: options.politeDelayMs, model: llm?.model ?? null }));
  await writeFile(join(auditsDir, "sweep.json"), JSON.stringify({ date: today, delayMs: options.politeDelayMs, model: llm?.model ?? null, shops: rows, totals: sums }, null, 2) + "\n");
  console.log(`\n${sums.audited}/${sums.shops} audited, ${rows.filter((r) => r.outcome === "reached-goal").length} walked the whole path.`);
  console.log(`Wrote ${join(auditsDir, "sweep.md")}`);
}

if (command === "survey") await survey();
else if (command === "sweep") await (values.render ? render() : sweep());
else {
  console.error("Usage: cli.ts survey | sweep (see the header of this file)");
  process.exitCode = 2;
}
