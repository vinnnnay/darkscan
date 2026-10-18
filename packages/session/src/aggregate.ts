import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { PATTERNS, type AuditRun, type Finding, type PatternId } from "@darkscan/schema";
import { loadRun } from "./load.ts";

export type Session = { name: string; run: AuditRun; findings: Finding[] };

type Counts = { likely: number; review: number };

const hostOf = (run: AuditRun) => {
  try {
    return new URL(run.target).host.replace(/^www\./, "");
  } catch {
    return run.target;
  }
};

/**
 * Loads every folder under `dir` that holds a run.json, skipping (and naming) the ones that are not valid.
 * Bundles may come from anyone, so each one goes through the same validation as `analyze`.
 */
export async function loadSessions(dir: string, detect: (run: AuditRun) => Finding[] | Promise<Finding[]>): Promise<{ sessions: Session[]; skipped: string[] }> {
  const sessions: Session[] = [];
  const skipped: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const run = await loadRun(join(dir, entry.name));
      sessions.push({ name: entry.name, run, findings: await detect(run) });
    } catch (error) {
      skipped.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { sessions, skipped };
}

/**
 * One page combining many people's recorded sessions: how many, on which shops, and which potential patterns
 * showed up how often. Written for the person running the study. It reports counts, never verdicts: a count
 * is a reason to look at the evidence, and nothing here should be published about a named company until a
 * person has checked that evidence.
 */
export function renderSummary(sessions: Session[], skipped: string[] = []): string {
  const byHost = new Map<string, Session[]>();
  for (const s of sessions) byHost.set(hostOf(s.run), [...(byHost.get(hostOf(s.run)) ?? []), s]);

  const steps = sessions.reduce((n, s) => n + s.run.steps.length, 0);
  const stoppedAtPayment = sessions.filter((s) => s.run.steps.some((st) => st.action.startsWith("payment page reached"))).length;
  const lines: string[] = [
    "# DarkScan study summary",
    "",
    `**${sessions.length} recorded session${sessions.length === 1 ? "" : "s"}** on **${byHost.size} shop${byHost.size === 1 ? "" : "s"}**, ${steps} recorded steps in all. ${stoppedAtPayment} reached payment, where recording stops by design.`,
    "",
    "> These are counts of *potential* patterns found by an automated test in what people recorded. They are not legal findings,",
    "> and a pattern seen in one session may be a quirk of that session. Check the evidence in each session's report before",
    "> saying anything about a named company.",
    "",
  ];

  const hosts = [...byHost].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [host, group] of hosts) {
    const counts = new Map<PatternId, Counts>();
    for (const s of group) {
      // One session counts once per pattern, however many times it showed up inside that session.
      for (const pattern of new Set(s.findings.filter((f) => f.status !== "ok").map((f) => f.pattern))) {
        const best = s.findings.some((f) => f.pattern === pattern && f.status === "likely") ? "likely" : "review";
        const c = counts.get(pattern) ?? { likely: 0, review: 0 };
        c[best]++;
        counts.set(pattern, c);
      }
    }
    lines.push(`## ${host}`, "", `${group.length} session${group.length === 1 ? "" : "s"}${group.length < 3 ? " (too few to say anything general about this shop)" : ""}.`, "");
    if (counts.size === 0) {
      lines.push("No potential patterns found in these sessions. Each session's report says what it could not see.", "");
      continue;
    }
    lines.push("| Pattern | Likely | Needs review | Of sessions |", "|---|---|---|---|");
    for (const [pattern, c] of [...counts].sort((a, b) => b[1].likely - a[1].likely || b[1].review - a[1].review)) {
      lines.push(`| ${PATTERNS[pattern].name} | ${c.likely} | ${c.review} | ${group.length} |`);
    }
    lines.push("");
  }

  if (skipped.length) lines.push("## Skipped", "", ...skipped.map((s) => `- ${s}`), "");
  return lines.join("\n");
}
