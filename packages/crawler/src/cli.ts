// Usage: npm run crawl -- --variant 1 [--base http://localhost:4173] [--out runs] [--headed] [--delay 0]
// Start DarkBench first with `npm run build:bench && npm run serve:bench`.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runAudit } from "./crawl.ts";
import { darkbenchRecipe } from "./recipe.ts";

const { values } = parseArgs({
  options: {
    variant: { type: "string", default: "1" },
    base: { type: "string", default: "http://localhost:4173" },
    out: { type: "string", default: "runs" },
    delay: { type: "string", default: "0" },
    headed: { type: "boolean", default: false },
  },
});

// npm runs workspace scripts inside the package folder; resolve --out against where the user ran npm.
const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
const run = await runAudit(darkbenchRecipe(values.base, Number(values.variant)), {
  outDir,
  headless: !values.headed,
  politeDelayMs: Number(values.delay),
  allowAccountCreation: true,
});

console.log(`${run.status}: ${run.steps.length} steps → ${resolve(outDir, run.id)}`);
if (run.note) console.log(run.note);
for (const step of run.steps) {
  const total = step.price?.totalPaise != null ? ` total ₹${step.price.totalPaise / 100}` : "";
  const sneaked = step.cart?.filter((c) => !c.addedByAgent).map((c) => c.name) ?? [];
  console.log(
    `  ${String(step.index).padStart(2)} ${step.action}${total}` +
      (step.dialog ? ` [declined: "${step.dialog.dismissedWith}"]` : "") +
      (sneaked.length ? ` [not added by agent: ${sneaked.join(", ")}]` : ""),
  );
}
process.exitCode = run.status === "failed" ? 1 : 0;
