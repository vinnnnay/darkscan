import { ANNEXURE_CAVEAT, PATTERNS, PATTERN_NOTES, type PatternId } from "@darkscan/schema/patterns";
import type { AuditRun, Finding, Step } from "@darkscan/schema";

export type ReportMode = "crawler" | "recorded-session";

export type ReportInput = {
  run: AuditRun;
  findings: Finding[];
  mode: ReportMode;
  /** Which detectors produced the findings, e.g. "rules" or "rules + qwen2.5:3b". */
  detectors: string;
  generatedAt: string;
};

/**
 * Everything that reaches the page is untrusted: page text comes from third-party sites, and a
 * recorded session may have been made by anyone. Escape it all, never build markup from it.
 */
export function esc(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only files the tool itself writes: step-000.png and the like. Anything else (a path, a URL) is dropped. */
export function safeImage(name: string): string | null {
  return /^step-\d{3,5}\.png$/.test(name) ? name : null;
}

/** Facts about what the audit could and could not see, so a clean report is not mistaken for a clean bill of health. */
export function coverage(run: AuditRun): { saw: string[]; missed: string[] } {
  const saw: string[] = [];
  const missed: string[] = [];
  const sawCart = run.steps.some((s) => (s.cart?.length ?? 0) > 0);
  const sawPrices = run.steps.some((s) => (s.price?.lines.length ?? 0) > 0);
  const sawPopup = run.steps.some((s) => s.dialog !== null);
  const sawProduct = run.steps.length > 1;

  if (sawProduct) saw.push("pages reached by browsing like a shopper");
  if (sawPopup) saw.push("popups and their buttons");
  if (sawCart) saw.push("the cart");
  if (sawPrices) saw.push("order price summaries");

  if (!sawCart) missed.push("The cart was never seen, so basket sneaking could not be tested.");
  if (!sawPrices) missed.push("No order price summary was captured, so drip pricing could not be tested.");
  else if (run.steps.filter((s) => (s.price?.lines.length ?? 0) > 0).length < 2) {
    missed.push("Only one price summary was captured, so a fee appearing late (drip pricing) could not be compared.");
  }
  if (run.note) missed.push(`The audit ended early: ${run.note}`);
  if (run.status === "not_auditable") missed.push("The site could not be audited, so nothing here says anything about its checkout.");
  const untestable = (Object.keys(PATTERNS) as PatternId[]).filter((id) => !PATTERNS[id].inScope).map((id) => PATTERNS[id].name);
  missed.push(`${untestable.join(", ")} need a payment or a software install to observe, so DarkScan does not test them.`);
  return { saw, missed };
}

const STATUS_LABEL: Record<Finding["status"], string> = { likely: "Likely", review: "Needs review", ok: "OK" };

/** Most serious first: likely before review, then by confidence. */
export function ranked(findings: Finding[]): Finding[] {
  const order = { likely: 0, review: 1, ok: 2 } as const;
  return [...findings].filter((f) => f.status !== "ok").sort((a, b) => order[a.status] - order[b.status] || b.confidence - a.confidence);
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function figure(step: Step): string {
  const img = safeImage(step.screenshot);
  return `<figure>${img ? `<a href="${img}"><img src="${img}" alt="Screenshot of step ${step.index}: ${esc(step.action)}" loading="lazy"></a>` : `<div class="noimg">No screenshot</div>`}
<figcaption>Step ${step.index} · ${esc(step.action)}<br><span class="muted">${esc(step.url)}</span></figcaption></figure>`;
}

export function renderReportHtml(input: ReportInput): string {
  const { run, findings, mode, detectors, generatedAt } = input;
  const shown = ranked(findings);
  const likely = shown.filter((f) => f.status === "likely").length;
  const cov = coverage(run);
  const byIndex = new Map(run.steps.map((s) => [s.index, s]));
  const title = `DarkScan report: ${host(run.target)}`;

  const findingCards = shown
    .map((f) => {
      const p = PATTERNS[f.pattern];
      const evidence = f.evidenceSteps.slice(0, 4).map((i) => byIndex.get(i)).filter((s): s is Step => s !== undefined);
      return `<article class="finding ${f.status}">
<h3>${esc(p.name)} <span class="badge ${f.status}">${STATUS_LABEL[f.status]}</span></h3>
<p class="meta">Possible breach of CCPA dark-pattern guidelines (2023), Annexure 1, item ${p.annex} · confidence ${Math.round(f.confidence * 100)}% · found by ${f.detector === "rule" ? "a rule" : "a language model"}</p>
<p>${esc(f.explanation)}</p>${PATTERN_NOTES[f.pattern] ? `\n<p class="note"><strong>What the guideline says.</strong> ${esc(PATTERN_NOTES[f.pattern])}</p>` : ""}
<div class="evidence">${evidence.map(figure).join("\n")}</div>
</article>`;
    })
    .join("\n");

  const timeline = run.steps
    .map((s) => `<tr><td>${s.index}</td><td>${esc(s.action)}</td><td class="muted">${esc(s.url)}</td></tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1c1f24;--muted:#5f6672;--line:#dde1e6;--card:#f6f7f9;--likely:#b3261e;--review:#8a5a00;--ok:#1e6b34}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaee;--muted:#9aa1ad;--line:#2d3139;--card:#1c1f25;--likely:#ff8a80;--review:#f2c26b;--ok:#7bd88f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.2rem;margin:32px 0 12px}h3{font-size:1.05rem;margin:0 0 4px}
.muted{color:var(--muted)}.notice{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}
.finding{border:1px solid var(--line);border-left-width:5px;border-radius:8px;padding:12px 16px;margin:12px 0;background:var(--card)}
.finding.likely{border-left-color:var(--likely)}.finding.review{border-left-color:var(--review)}
.badge{font-size:.72rem;padding:2px 8px;border-radius:99px;border:1px solid currentColor;vertical-align:middle;margin-left:6px}.badge.likely{color:var(--likely)}.badge.review{color:var(--review)}
.meta{font-size:.85rem;color:var(--muted);margin:0 0 8px}.note{font-size:.86rem;color:var(--muted);margin:8px 0}.evidence{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;width:200px}figure img{width:100%;max-height:260px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:6px}
figcaption{font-size:.78rem;word-break:break-word}.noimg{height:90px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:6px;font-size:.8rem}
table{width:100%;border-collapse:collapse;font-size:.88rem}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
ul{padding-left:20px}
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="muted">${mode === "recorded-session" ? "Recorded by a person shopping in their own browser" : "Tested by DarkScan's automated shopper"} · run ${esc(run.id)} · ${esc(run.startedAt)} · generated ${esc(generatedAt)}</p>

<div class="notice"><strong>How to read this.</strong> This report lists <em>potential</em> violations found by a test, each with the evidence behind it. It is not a legal finding and does not say that anyone broke the law. "Likely" findings have high confidence; "Needs review" ones are weaker. A person should check the evidence before acting on any of them. The guidelines themselves say their examples ${esc(ANNEXURE_CAVEAT)}.</div>

<h2>Summary</h2>
<p>${shown.length === 0 ? "No potential dark patterns were found in what this audit saw. Read “What this audit could not see” below before treating that as good news." : `${likely} likely and ${shown.length - likely} needing review, out of the patterns DarkScan can test.`}</p>
${shown.length ? `<table><thead><tr><th>Pattern</th><th>Status</th><th>Confidence</th></tr></thead><tbody>${shown.map((f) => `<tr><td>${esc(PATTERNS[f.pattern].name)}</td><td>${STATUS_LABEL[f.status]}</td><td>${Math.round(f.confidence * 100)}%</td></tr>`).join("")}</tbody></table>` : ""}

<h2>Findings</h2>
${findingCards || '<p class="muted">None.</p>'}

<h2>What this audit could not see</h2>
<ul>${cov.missed.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
${cov.saw.length ? `<p class="muted">It did see: ${esc(cov.saw.join(", "))}.</p>` : ""}

<h2>Steps taken</h2>
<table><thead><tr><th>#</th><th>Action</th><th>Page</th></tr></thead><tbody>${timeline}</tbody></table>

<h2>Method</h2>
<ul>
<li>Detectors: ${esc(detectors)}. Rules compare prices, carts, popups and countdowns; a language model, where used, judges only wording.</li>
<li>${mode === "recorded-session" ? "The session was recorded passively while a person used the site. DarkScan clicked nothing. Typed values are hidden in screenshots and removed from saved pages, and recording stopped at payment." : "The automated shopper obeys robots.txt, identifies itself, pauses between actions, browses as a guest, never signs up and stops before payment. It never solves bot checks."}</li>
<li>Each pattern maps to an item of Annexure 1 of the CCPA Guidelines for Prevention and Regulation of Dark Patterns, 2023 (notified 30 November 2023). The item numbers were checked against the Gazette of India text.</li>
</ul>
</main>
</body>
</html>
`;
}
