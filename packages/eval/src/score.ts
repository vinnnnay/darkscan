import { PATTERNS, type Finding, type PatternId } from "@darkscan/schema";

export type Split = "dev" | "test";
export type Case = { variant: number; split: Split; planted: PatternId[]; findings: Finding[] };

export type PatternScore = {
  pattern: PatternId;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** "review" findings: not counted as positives, reported so a human knows the load. */
  review: number;
  precision: number | null;
  recall: number | null;
  /** Variants where the detector was wrong, to make failures easy to inspect. */
  missed: number[];
  falseAlarms: number[];
};

/** Only "likely" findings count as positive predictions; "review" ones still need a human. */
export function score(cases: Case[], patterns: PatternId[]): PatternScore[] {
  return patterns.map((pattern) => {
    const s: PatternScore = { pattern, tp: 0, fp: 0, fn: 0, tn: 0, review: 0, precision: null, recall: null, missed: [], falseAlarms: [] };
    for (const c of cases) {
      const actual = c.planted.includes(pattern);
      const mine = c.findings.filter((f) => f.pattern === pattern);
      const predicted = mine.some((f) => f.status === "likely");
      if (mine.some((f) => f.status === "review")) s.review++;
      if (predicted && actual) s.tp++;
      else if (predicted) (s.fp++, s.falseAlarms.push(c.variant));
      else if (actual) (s.fn++, s.missed.push(c.variant));
      else s.tn++;
    }
    s.precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : null;
    s.recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : null;
    return s;
  });
}

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)}%`);

export function toMarkdown(scores: PatternScore[], heading: string): string {
  const rows = scores.map(
    (s) => `| ${PATTERNS[s.pattern].name} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} | ${s.review} |`,
  );
  const sum = (k: "tp" | "fp" | "fn") => scores.reduce((n, s) => n + s[k], 0);
  const [tp, fp, fn] = [sum("tp"), sum("fp"), sum("fn")];
  return [
    heading,
    "",
    "| Pattern | Precision | Recall | TP | FP | FN | TN | Review |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    `| **All rule detectors** | **${pct(tp + fp ? tp / (tp + fp) : null)}** | **${pct(tp + fn ? tp / (tp + fn) : null)}** | ${tp} | ${fp} | ${fn} | | |`,
    "",
  ].join("\n");
}

export type Baseline = Partial<Record<PatternId, { precision: number; recall: number }>>;
export type SplitBaseline = Partial<Record<Split, Baseline>>;

/** Returns a message for every pattern that scores below its recorded baseline. */
export function regressions(scores: PatternScore[], baseline: Baseline, prefix = ""): string[] {
  const out: string[] = [];
  for (const s of scores) {
    const b = baseline[s.pattern];
    if (!b) continue;
    if ((s.precision ?? 1) < b.precision) out.push(`${prefix}${s.pattern}: precision ${pct(s.precision)} < baseline ${pct(b.precision)}`);
    if ((s.recall ?? 1) < b.recall) out.push(`${prefix}${s.pattern}: recall ${pct(s.recall)} < baseline ${pct(b.recall)}`);
  }
  return out;
}
