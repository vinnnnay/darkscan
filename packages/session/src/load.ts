import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeImage } from "@darkscan/report";
import { AuditRunSchema, type AuditRun } from "@darkscan/schema";
import { makeRedactor } from "./redact.ts";

/** A run folder may come from anyone, so it is checked before it is trusted. */
export const LIMITS = { runJsonBytes: 25_000_000, steps: 1000 } as const;

/** Reads and validates <dir>/run.json. Throws a plain-English error if it is not a DarkScan run. */
export async function loadRun(dir: string): Promise<AuditRun> {
  const file = join(dir, "run.json");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`There is no run.json in ${dir}.`);
  if (info.size > LIMITS.runJsonBytes) throw new Error(`run.json is ${Math.round(info.size / 1e6)} MB, over the ${LIMITS.runJsonBytes / 1e6} MB limit.`);

  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("run.json is not valid JSON.");
  }
  const parsed = AuditRunSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`run.json is not a DarkScan run (${issue?.path.join(".") || "root"}: ${issue?.message}).`);
  }
  if (parsed.data.steps.length > LIMITS.steps) throw new Error(`run.json has ${parsed.data.steps.length} steps, over the limit of ${LIMITS.steps}.`);
  return parsed.data;
}

export type ExportOptions = {
  /** More words to mask, on top of what was masked while recording. */
  terms?: readonly string[];
  /** Keep the screenshots. Off gives a bundle with text evidence only. */
  screenshots?: boolean;
};

/**
 * Writes a copy of a run that is safer to share: every piece of text masked again (with any extra words),
 * saved pages left out, and screenshots included only if asked. Screenshots can show a name or address the
 * text masking never saw, so they are opt-in.
 */
export async function exportBundle(srcDir: string, outDir: string, options: ExportOptions = {}): Promise<{ steps: number; screenshots: number }> {
  const run = await loadRun(srcDir);
  const redact = makeRedactor(options.terms);
  await mkdir(outDir, { recursive: true });

  let copied = 0;
  const steps = [];
  for (const step of run.steps) {
    const image = safeImage(step.screenshot);
    const keep = options.screenshots === true && image !== null;
    if (keep) {
      await copyFile(join(srcDir, image), join(outDir, image)).then(() => copied++).catch(() => {});
    }
    steps.push({
      ...step,
      action: redact(step.action),
      url: redact(step.url),
      screenshot: keep ? step.screenshot : "",
      dom: "",
      visibleText: redact(step.visibleText),
      price: step.price && { ...step.price, lines: step.price.lines.map((l) => ({ ...l, label: redact(l.label) })) },
      cart: step.cart && step.cart.map((item) => ({ ...item, name: redact(item.name) })),
      dialog: step.dialog && {
        ...step.dialog,
        text: redact(step.dialog.text),
        buttons: step.dialog.buttons.map((b) => ({ ...b, text: redact(b.text) })),
        dismissedWith: step.dialog.dismissedWith === null ? null : redact(step.dialog.dismissedWith),
      },
      checkboxes: step.checkboxes.map((box) => ({ ...box, label: redact(box.label) })),
      links: step.links.map((link) => ({ text: redact(link.text), href: redact(link.href) })),
    });
  }
  const safe: AuditRun = { ...run, note: run.note === null ? null : redact(run.note), trace: null, steps };
  await writeFile(join(outDir, "run.json"), JSON.stringify(AuditRunSchema.parse(safe), null, 2));
  return { steps: steps.length, screenshots: copied };
}
