// Bring-your-own-session: a person shops in a real browser window, DarkScan records the evidence.
//
//   npm run record -- --url https://shop.example/ --site shop [--redact "Your Name, 9876543210, 12 MG Road"]
//                     [--no-screenshots] [--llm] [--out runs]
//   npm run analyze -- --run runs/<folder> [--llm]            (also for a folder someone sent you)
//   npm run export-run -- --run runs/<folder> --out share/<name> [--redact "..."] [--screenshots]
//   npm run record -- ... --share share             also leave a text-only copy in share/<id>, ready to send
//   npm run summarize -- --dir study [--out study/summary.md]   combine many people's sessions into one page
//
// DarkScan never clicks anything here. Typing and choices belong to the person.
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromiumArgs } from "@darkscan/crawler";
import { DEFAULT_MODEL, detectAll, detectWithLlm, ollama, ollamaReady } from "@darkscan/detectors";
import { writeReport } from "@darkscan/report";
import type { AuditRun } from "@darkscan/schema";
import { chromium } from "playwright";
import { loadSessions, renderSummary } from "./aggregate.ts";
import { exportBundle, loadRun } from "./load.ts";
import { parseTerms } from "./redact.ts";
import { SessionRecorder } from "./recorder.ts";

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    url: { type: "string" },
    site: { type: "string", default: "session" },
    run: { type: "string" },
    out: { type: "string" },
    redact: { type: "string" },
    "no-screenshots": { type: "boolean", default: false },
    screenshots: { type: "boolean", default: false },
    llm: { type: "boolean", default: false },
    model: { type: "string", default: DEFAULT_MODEL },
    headless: { type: "boolean", default: false },
    share: { type: "string" },
    "share-screenshots": { type: "boolean", default: false },
    dir: { type: "string" },
  },
});

const cwd = process.env.INIT_CWD ?? process.cwd();
const path = (p: string) => resolve(cwd, p);

if (values.llm && !(await ollamaReady(values.model))) {
  console.error(`Ollama isn't running or ${values.model} isn't pulled. Run: ollama pull ${values.model}`);
  process.exit(1);
}
const llm = values.llm ? ollama({ model: values.model, cacheDir: resolve(import.meta.dirname, "../../../.cache/llm") }) : null;

/** Runs the detectors on a run and writes report.html and findings.json beside it. */
async function analyse(run: AuditRun, dir: string) {
  const findings = llm ? await detectWithLlm(run, llm) : detectAll(run);
  const report = await writeReport(dir, run, findings, {
    // A run made by a person has no browser trace; one made by the automated shopper does.
    mode: run.trace === null ? "recorded-session" : "crawler",
    detectors: llm ? `rules + ${llm.model}` : "rules",
  });
  console.log(`\n${run.steps.length} steps. Findings (${findings.length}):`);
  for (const f of findings) console.log(`  [${f.status}] ${f.pattern} (${Math.round(f.confidence * 100)}%): ${f.explanation.slice(0, 200)}`);
  if (findings.length === 0) console.log("  none. The report lists what this session could not see.");
  console.log(`\nReport: ${report}`);
}

async function main() {
if (command === "record") {
  if (!values.url) throw new Error("record needs --url");
  const start = new URL(values.url);
  if (!/^https?:$/.test(start.protocol)) throw new Error("--url must be an http(s) address");

  const browser = await chromium.launch({ headless: values.headless, args: chromiumArgs() });
  const context = await browser.newContext({ viewport: values.headless ? { width: 1280, height: 900 } : null, locale: "en-IN" });
  const page = await context.newPage();
  const recorder = await SessionRecorder.attach(context, page, {
    outDir: path(values.out ?? "runs"),
    site: values.site,
    startUrl: values.url,
    redact: parseTerms(values.redact),
    screenshots: !values["no-screenshots"],
    log: (line) => console.log(`  · ${line}`),
  });

  console.log(`
DarkScan is recording. You are in control: it never clicks anything.

  • Shop as you normally would, up to the point of paying.
  • Do NOT enter real payment details. Recording stops by itself when a payment page appears.
  • Typed values are hidden in screenshots and never saved. Emails, phone, card, Aadhaar and PAN numbers are masked.
  • A name or address that the PAGE shows is only masked if you list it: --redact "Your Name, 12 MG Road".
  • Wait a second after your last click, then close the browser window (or press Enter here).
`);
  await page.goto(values.url).catch((error) => console.log(`  · couldn't open ${values.url}: ${error instanceof Error ? error.message : error}`));

  await Promise.race([
    new Promise<void>((done) => browser.on("disconnected", () => done())),
    new Promise<void>((done) => {
      process.stdin.resume();
      process.stdin.once("data", () => done());
    }),
  ]);
  const run = await recorder.finish();
  await browser.close().catch(() => {});
  process.stdin.pause();
  await analyse(run, recorder.folder);
  if (values.share) {
    // A copy that is safer to send: text only unless asked, masked again with the words the person listed.
    const out = join(path(values.share), run.id);
    const result = await exportBundle(recorder.folder, out, { terms: parseTerms(values.redact), screenshots: values["share-screenshots"] });
    console.log(`\nShareable copy (${result.steps} steps, ${result.screenshots} screenshots): ${out}`);
    console.log("Look through it before you send it. Names and addresses nobody listed are still there, and so is anything in a screenshot.");
  }
} else if (command === "summarize") {
  if (!values.dir) throw new Error("summarize needs --dir <folder holding one folder per session>");
  const dir = path(values.dir);
  const { sessions, skipped } = await loadSessions(dir, (run) => (llm ? detectWithLlm(run, llm) : detectAll(run)));
  const out = path(values.out ?? join(values.dir, "summary.md"));
  await writeFile(out, renderSummary(sessions, skipped));
  console.log(`${sessions.length} sessions summarised${skipped.length ? `, ${skipped.length} skipped` : ""}: ${out}`);
  for (const line of skipped) console.log(`  skipped ${line}`);
} else if (command === "analyze") {
  if (!values.run) throw new Error("analyze needs --run <folder>");
  const dir = path(values.run);
  await analyse(await loadRun(dir), dir);
} else if (command === "export") {
  if (!values.run || !values.out) throw new Error("export needs --run <folder> and --out <folder>");
  const result = await exportBundle(path(values.run), path(values.out), { terms: parseTerms(values.redact), screenshots: values.screenshots });
  console.log(`Exported ${result.steps} steps and ${result.screenshots} screenshots to ${path(values.out)}.`);
  console.log("Look through it before you share it: names and addresses that no one listed are still there, and so is anything in a screenshot.");
} else {
  console.error("Usage: cli.ts record | analyze | export (see the header of this file)");
  process.exitCode = 2;
}
}

// A folder someone sent, or a mistyped path, should produce a plain message, not a stack trace.
main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
