// One audit run per shop, with the same rails a real audit must have.
import { learnRecipe, type AgentConfig } from "@darkscan/agent";
import type { AuditOptions, Recipe } from "@darkscan/crawler";
import { detectAll, detectWithLlm, type Llm } from "@darkscan/detectors";
import { writeReport } from "@darkscan/report";
import type { AuditRun, Finding } from "@darkscan/schema";
import { join } from "node:path";
import type { SweepRow } from "./markdown.ts";
import { stripAnsi } from "./markdown.ts";
import type { Shop } from "./shops.ts";

export type SweepOutcome = SweepRow["outcome"];

/** The public row, plus the parts that stay out of the committed write-up. */
export type ShopAudit = { row: SweepRow; run: AuditRun; recipe: Recipe; findings: Finding[] };

/**
 * A run that reached a checkout form, an account wall or payment is a success: those are the
 * three places an honest audit stops. Anything else is reported as what it was, not as a success.
 */
export function outcomeOf(run: AuditRun, reachedGoal: boolean): SweepOutcome {
  if (run.status === "not_auditable") return "not-auditable";
  if (reachedGoal) return "reached-goal";
  return run.status === "failed" ? "failed" : "stopped";
}

/**
 * Trims a stop reason to one line for the table; the full text stays in the run. Playwright writes
 * terminal colour codes and a call log into its timeout messages, and neither belongs in a document.
 */
export const oneLine = (text: string, max = 160) => {
  const line = stripAnsi(text).split(/\bCall log:/)[0]!.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export async function auditShop(shop: Shop, options: AuditOptions, config: AgentConfig, llm: Llm | null): Promise<ShopAudit> {
  const { recipe, run, exploration } = await learnRecipe(shop.id, shop.home, options, config);
  const findings = run.steps.length > 0 ? (llm ? await detectWithLlm(run, llm) : detectAll(run)) : [];
  if (run.steps.length > 0) {
    await writeReport(join(options.outDir, run.id), run, findings, { mode: "crawler", detectors: llm ? `rules + ${llm.model}` : "rules" });
  }
  const row: SweepRow = {
    id: shop.id,
    name: shop.name,
    outcome: outcomeOf(run, exploration.reachedGoal),
    reached: exploration.reached,
    steps: recipe.steps.length,
    modelCalls: exploration.modelCalls,
    stop: oneLine(run.note ?? exploration.stop),
    runId: run.id,
  };
  return { row, run, recipe, findings };
}

export function totals(audits: ShopAudit[], shops: number) {
  const counted = audits.filter((a) => a.row.outcome !== "not-auditable");
  const count = (status: Finding["status"]) => counted.reduce((n, a) => n + a.findings.filter((f) => f.status === status).length, 0);
  return {
    shops,
    audited: counted.length,
    likely: count("likely"),
    review: count("review"),
    shopsWithAny: counted.filter((a) => a.findings.some((f) => f.status !== "ok")).length,
  };
}
