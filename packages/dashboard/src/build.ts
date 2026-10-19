// Builds the static dashboard from the eval results committed in eval/ (or re-run by CI first).
//
//   npm run dashboard -- [--out site/dashboard] [--base-url https://owner.github.io/darkscan]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderDashboard, type Board, type Field, type Scores } from "./render.ts";

const repo = process.env.GITHUB_REPOSITORY;
const { values } = parseArgs({
  options: {
    out: { type: "string", default: "site/dashboard" },
    "base-url": { type: "string", default: repo ? `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}` : "/" },
    repo: { type: "string", default: repo ? `https://github.com/${repo}` : "https://github.com/" },
  },
});

const root = resolve(import.meta.dirname, "../../..");
const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out!);

const SOURCES = [
  { id: "rules", file: "results.json", title: "Rule detectors", blurb: "Code-only detectors on a crawl with a hand-written recipe. Runs free in CI." },
  { id: "llm", file: "results-llm.json", title: "Rules + local model", blurb: "Adds qwen2.5:3b (via Ollama) for wording-based patterns. Scores come from a local run." },
  { id: "agent", file: "results-agent.json", title: "Recipe agent", blurb: "The agent finds the checkout path itself and never signs up, so account walls hide the checkout page." },
];

const boards: Board[] = [];
for (const s of SOURCES) {
  try {
    boards.push({ id: s.id, title: s.title, blurb: s.blurb, scores: JSON.parse(await readFile(join(root, "eval", s.file), "utf8")) as Scores });
  } catch {
    console.warn(`skipping ${s.title}: eval/${s.file} not found`);
  }
}
if (boards.length === 0) throw new Error("No eval results found. Run `npm run eval` first.");

/** The field artifacts are optional: the page still builds for anyone who has not run a sweep. */
async function readAudit<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(root, "audits", name), "utf8")) as T;
  } catch {
    console.warn(`skipping audits/${name}: not found, so the real-shop panel will be partial`);
    return null;
  }
}
const field: Field = {
  survey: await readAudit<Field["survey"]>("robots.json"),
  sweep: await readAudit<Field["sweep"]>("sweep.json"),
};

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "index.html"),
  renderDashboard({
    boards,
    field,
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    benchUrl: values["base-url"]!,
    repoUrl: values.repo!,
  }),
);
console.log(`Dashboard: ${join(outDir, "index.html")} (${boards.length} boards)`);
