import { PATTERNS, type PatternId } from "@darkscan/schema";

/** One row of eval/results*.json, as the eval CLI writes it. */
export type Row = { pattern: PatternId; tp: number; fp: number; fn: number; tn: number; review: number; precision: number | null; recall: number | null };
export type Scores = Partial<Record<"dev" | "test", Row[]>>;
export type Board = { id: string; title: string; blurb: string; scores: Scores };

export type DashboardInput = { boards: Board[]; generatedAt: string; commit: string | null; benchUrl: string; repoUrl: string };

export const esc = (text: unknown) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)}%`);

/** Pooled over all patterns, as in RESULTS.md's last row. */
export function overall(rows: Row[]): { precision: number | null; recall: number | null } {
  const sum = (k: "tp" | "fp" | "fn") => rows.reduce((n, r) => n + r[k], 0);
  const [tp, fp, fn] = [sum("tp"), sum("fp"), sum("fn")];
  return { precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

/** Colour is never the only signal: the number is always printed. */
const tone = (x: number | null) => (x === null ? "na" : x >= 0.9 ? "good" : x >= 0.7 ? "mid" : "bad");
const cell = (x: number | null) => `<td class="num ${tone(x)}">${pct(x)}</td>`;

function table(rows: Row[]): string {
  const all = overall(rows);
  const body = rows
    .map((r) => `<tr><th scope="row">${esc(PATTERNS[r.pattern]?.name ?? r.pattern)}</th>${cell(r.precision)}${cell(r.recall)}<td class="num">${r.tp}</td><td class="num">${r.fp}</td><td class="num">${r.fn}</td><td class="num">${r.review}</td></tr>`)
    .join("");
  return `<div class="scroll"><table><thead><tr><th>Pattern</th><th>Precision</th><th>Recall</th><th>TP</th><th>FP</th><th>FN</th><th>Review</th></tr></thead><tbody>${body}<tr class="all"><th scope="row">All patterns</th>${cell(all.precision)}${cell(all.recall)}<td></td><td></td><td></td><td></td></tr></tbody></table></div>`;
}

export function renderDashboard(input: DashboardInput): string {
  const { boards, generatedAt, commit, benchUrl, repoUrl } = input;
  const headline = boards
    .map((b) => {
      const t = b.scores.test ? overall(b.scores.test) : null;
      return `<div class="tile"><div class="label">${esc(b.title)}</div><div class="big">${t ? pct(t.recall) : "–"}</div><div class="sub">held-out recall · precision ${t ? pct(t.precision) : "–"}</div></div>`;
    })
    .join("");
  const sections = boards
    .map(
      (b) => `<section id="${esc(b.id)}"><h2>${esc(b.title)}</h2><p class="muted">${esc(b.blurb)}</p>
${(["test", "dev"] as const).filter((s) => b.scores[s]).map((s) => `<h3>${s === "test" ? "Held-out split (variants 25–49)" : "Dev split (variants 0–24)"}</h3>${table(b.scores[s]!)}`).join("\n")}</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DarkScan Dashboard</title>
<style>
:root{--bg:#fff;--fg:#1c1f24;--muted:#5f6672;--line:#dde1e6;--card:#f6f7f9;--good:#1e6b34;--mid:#8a5a00;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaee;--muted:#9aa1ad;--line:#2d3139;--card:#1c1f25;--good:#7bd88f;--mid:#f2c26b;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.25rem;margin:36px 0 4px}h3{font-size:1rem;margin:20px 0 8px}
.muted{color:var(--muted)}a{color:inherit}.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}
.tile{flex:1 1 200px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px}.label{font-size:.85rem;color:var(--muted)}.big{font-size:2rem;font-weight:700}.sub{font-size:.8rem;color:var(--muted)}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}td.num{text-align:right;font-variant-numeric:tabular-nums}
.good{color:var(--good)}.mid{color:var(--mid)}.bad{color:var(--bad)}.all th,.all td{font-weight:700}
.notice{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}
</style>
</head>
<body>
<main>
<h1>DarkScan dashboard</h1>
<p class="muted">Scores against DarkBench's answer key · generated ${esc(generatedAt)}${commit ? ` · commit ${esc(commit.slice(0, 7))}` : ""} · <a href="${esc(benchUrl)}">try DarkBench</a> · <a href="${esc(repoUrl)}">source</a></p>
<div class="notice"><strong>What this measures.</strong> Detectors are scored on a fake shop with planted patterns, not on real companies. The held-out split uses wording the detectors were never tuned on. Only "likely" findings count as detections; "review" ones need a human. Nothing here is a legal finding about any real site.</div>
<div class="tiles">${headline}</div>
${sections}
<h2>Rerun</h2>
<p>This page is rebuilt by a GitHub Actions workflow every week and on demand (Actions → Eval dashboard → Run workflow). Each run re-crawls all 50 variants and fails if any detector drops below its recorded baseline.</p>
</main>
</body>
</html>
`;
}
