import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditRun, Finding } from "@darkscan/schema";
import { renderReportHtml, type ReportMode } from "./render.ts";

/** Writes report.html and findings.json into the run's folder, next to its screenshots. */
export async function writeReport(runDir: string, run: AuditRun, findings: Finding[], options: { mode: ReportMode; detectors: string }) {
  const html = renderReportHtml({ run, findings, generatedAt: new Date().toISOString(), ...options });
  await writeFile(join(runDir, "report.html"), html);
  await writeFile(join(runDir, "findings.json"), JSON.stringify(findings, null, 2) + "\n");
  return join(runDir, "report.html");
}
