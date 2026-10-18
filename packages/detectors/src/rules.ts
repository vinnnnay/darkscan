import type { AuditRun, Finding, PriceLine, Step } from "@darkscan/schema";
import { contrastRatio, finding, pageSteps, rupees } from "./util.ts";

const CHARGE_KINDS = new Set<PriceLine["kind"]>(["fee", "tax", "shipping"]);

/**
 * Drip pricing: a fee, tax or delivery charge that shows up late in the flow without
 * having been mentioned on any earlier page. Charges disclosed upfront are fine,
 * even if they're only added to the total at checkout.
 */
export function dripPricing(run: AuditRun): Finding[] {
  const priced = run.steps.filter((s) => s.price && s.price.lines.length > 0);
  const first = priced[0];
  const last = priced.at(-1);
  if (!first || !last || first === last) return [];

  const findings: Finding[] = [];
  for (const line of last.price!.lines) {
    if (!CHARGE_KINDS.has(line.kind) || line.amountPaise <= 0) continue;
    const label = line.label.toLowerCase();
    const appeared = priced.find((s) => s.price!.lines.some((l) => l.label.toLowerCase() === label))!;
    if (appeared === first) continue;
    const before = run.steps.filter((s) => s.index < appeared.index);
    if (before.some((s) => disclosedIn(s.visibleText, line.label))) continue;
    findings.push(
      finding(
        "drip_pricing",
        0.9,
        [first.index, appeared.index],
        `"${line.label}" (${rupees(line.amountPaise)}) first appears at step ${appeared.index} and is not mentioned on any earlier page.`,
      ),
    );
  }
  return merge(findings);
}

// Words that say what kind of charge a line is, not which one. "GST @ 18%" is disclosed by
// "18% GST is added at checkout" even though the exact label never appears.
const GENERIC = new Set(["fee", "fees", "charge", "charges", "cost", "costs", "of", "on", "per", "order", "the", "a", "applicable"]);

// A disclosure talks about money: an amount, or a word that says something is charged.
const CHARGE_CONTEXT = /₹|\brs\.?\s*\d|\b(fee|fees|charge|charges|charged|tax|gst|added|applies|apply|applicable|extra)\b/;

/** True if one line of `text` mentions every distinctive word of the charge's label, as a charge. */
function disclosedIn(text: string, label: string): boolean {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? [];
  const terms = words.filter((w) => !GENERIC.has(w));
  const lines = text.toLowerCase().split("\n").filter((l) => CHARGE_CONTEXT.test(l));
  if (terms.length === 0) return lines.some((l) => l.includes(label.toLowerCase()));
  return lines.some((l) => terms.every((t) => new RegExp(`\\b${t}\\b`).test(l)));
}

/**
 * Basket sneaking: an item the crawler never added (it declines every upsell) that the
 * shopper would pay for. Free items are not flagged; items with no visible price go to review.
 */
export function basketSneaking(run: AuditRun): Finding[] {
  const seen = new Map<string, Step>();
  for (const step of run.steps) {
    for (const item of step.cart ?? []) {
      if (!item.addedByAgent && !seen.has(item.name)) seen.set(item.name, step);
    }
  }
  const findings: Finding[] = [];
  for (const [name, step] of seen) {
    const cost = itemCost(run, name);
    if (cost === 0) continue;
    const added = `"${name}" was in the cart at step ${step.index}, but the shopper never added it and declined every add-on offer`;
    findings.push(
      cost === null
        ? finding("basket_sneaking", 0.6, [step.index], `${added}. Its price could not be read, so check whether it is charged.`)
        : finding("basket_sneaking", 0.9, [step.index], `${added}. It adds ${rupees(cost)} to the order.`),
    );
  }
  return findings;
}

/** The item's price from any order summary in the run: null if it never appears there. */
function itemCost(run: AuditRun, name: string): number | null {
  const lower = name.toLowerCase();
  for (const step of run.steps) {
    const line = step.price?.lines.find((l) => l.label.toLowerCase().startsWith(lower) || lower.startsWith(l.label.toLowerCase()));
    if (line) return line.amountPaise;
  }
  return null;
}

// "Deal ends in 09:56", "Offer expires 01:59:30": a countdown on a line that talks about urgency.
const COUNTDOWN = /(ends?|expires?|left|hurry|offer|deal|sale)[^\n]*?\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/i;
const SCARCITY = /\bonly \d+ left\b|\bselling fast\b|\b\d+ people are (viewing|looking)/i;

function countdownSeconds(text: string): number | null {
  const m = COUNTDOWN.exec(text);
  if (!m) return null;
  const [a, b, c] = [Number(m[2]), Number(m[3]), m[4] === undefined ? null : Number(m[4])];
  return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
}

/** False urgency: a countdown that goes back up when the page is reloaded is not a real deadline. */
export function falseUrgency(run: AuditRun): Finding[] {
  const steps = pageSteps(run.steps);
  for (let i = 1; i < steps.length; i++) {
    const [before, after] = [steps[i - 1]!, steps[i]!];
    if (after.action !== "reload" || before.url !== after.url) continue;
    const [t1, t2] = [countdownSeconds(before.visibleText), countdownSeconds(after.visibleText)];
    if (t1 !== null && t2 !== null && t2 > t1) {
      const scarcity = SCARCITY.exec(after.visibleText)?.[0];
      return [
        finding(
          "false_urgency",
          0.9,
          [before.index, after.index],
          `Countdown went from ${fmt(t1)} to ${fmt(t2)} after a page reload, so it restarts instead of counting down to a real deadline.` +
            (scarcity ? ` The page also claims "${scarcity}".` : ""),
        ),
      ];
    }
  }
  const scarce = steps.find((s) => SCARCITY.test(s.visibleText));
  return scarce
    ? [finding("false_urgency", 0.4, [scarce.index], `Unverifiable scarcity claim: "${SCARCITY.exec(scarce.visibleText)![0]}".`)]
    : [];
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Interface interference: the option the shopper probably wants (decline) is made far
 * smaller or fainter than the option the business wants.
 */
export function interfaceInterference(run: AuditRun): Finding[] {
  const findings: Finding[] = [];
  for (const step of run.steps) {
    const dialog = step.dialog;
    if (!dialog?.dismissedWith) continue;
    const decline = dialog.buttons.find((b) => b.text === dialog.dismissedWith);
    const accept = dialog.buttons
      .filter((b) => b !== decline)
      .sort((a, b) => b.widthPx * b.heightPx - a.widthPx * a.heightPx)[0];
    if (!decline || !accept) continue;

    const areaRatio = (accept.widthPx * accept.heightPx) / Math.max(1, decline.widthPx * decline.heightPx);
    const contrast = contrastRatio(decline.color, decline.background) ?? 21;
    const reasons: string[] = [];
    if (areaRatio >= 4) reasons.push(`"${accept.text}" is ${areaRatio.toFixed(1)}× the size of "${decline.text}"`);
    if (contrast < 3) reasons.push(`"${decline.text}" has a text contrast of ${contrast.toFixed(1)}:1 (WCAG asks for at least 4.5:1)`);
    if (decline.fontSizePx < 12) reasons.push(`its text is only ${decline.fontSizePx}px`);
    if (reasons.length === 0) continue;

    const confidence = areaRatio >= 4 && (contrast < 3 || decline.fontSizePx < 12) ? 0.85 : 0.5;
    findings.push(finding("interface_interference", confidence, [step.index], `In the "${firstLine(dialog.text)}" popup, ${reasons.join(", ")}.`));
  }
  return merge(findings);
}

/** Nagging: the same popup keeps coming back after the shopper has said no. */
export function nagging(run: AuditRun): Finding[] {
  const shown = new Map<string, number[]>();
  for (const step of run.steps) {
    if (!step.dialog) continue;
    const key = firstLine(step.dialog.text);
    shown.set(key, [...(shown.get(key) ?? []), step.index]);
  }
  return [...shown]
    .filter(([, steps]) => steps.length >= 2)
    .map(([title, steps]) =>
      finding(
        "nagging",
        steps.length >= 3 ? 0.85 : 0.5,
        steps,
        `The "${title}" popup was shown ${steps.length} times in one visit, despite being declined each time.`,
      ),
    );
}

const ACCOUNT_WALL = /(create|sign up for|register for) an account to (continue|checkout)|(log|sign) ?in to (continue|checkout)/i;
const GUEST = /guest checkout|continue as guest|checkout as guest/i;

/** Forced action: checkout can't continue without creating an account. */
export function forcedAction(run: AuditRun): Finding[] {
  const wall = run.steps.find((s) => ACCOUNT_WALL.test(s.visibleText) && !GUEST.test(s.visibleText));
  if (!wall) return [];
  const stopped = run.note?.includes("requires creating an account");
  return [
    finding(
      "forced_action",
      0.85,
      [wall.index],
      `At step ${wall.index} the site says "${ACCOUNT_WALL.exec(wall.visibleText)![0]}" and offers no guest checkout.` +
        (stopped ? " The audit stopped here because it never creates accounts on real sites." : ""),
    ),
  ];
}

const UNAVAILABLE = /\b(out of stock|currently unavailable|sold out|no longer available)\b/i;
const PRICE = /₹\s*([\d,]+)/g;

/**
 * Bait and switch: an advertised price leads to a page where that item can't be
 * bought, but a pricier one is pushed instead. A plain stock-out is only flagged for review.
 */
export function baitAndSwitch(run: AuditRun): Finding[] {
  for (const step of run.steps) {
    if (!step.action.startsWith("click ")) continue;
    const advertised = prices(step.action)[0];
    if (advertised === undefined || !UNAVAILABLE.test(step.visibleText)) continue;
    const pricier = prices(step.visibleText).filter((p) => p > advertised);
    const what = UNAVAILABLE.exec(step.visibleText)![0];
    if (pricier.length) {
      return [
        finding(
          "bait_and_switch",
          0.8,
          [step.index],
          `The link advertised ${rupees(advertised * 100)}, but the item is "${what}" and the page pushes a ${rupees(Math.max(...pricier) * 100)} alternative.`,
        ),
      ];
    }
    return [finding("bait_and_switch", 0.4, [step.index], `The link advertised ${rupees(advertised * 100)}, but the item is "${what}".`)];
  }
  return [];
}

function prices(text: string): number[] {
  return [...text.matchAll(PRICE)].map((m) => Number(m[1]!.replace(/,/g, "")));
}

function firstLine(text: string) {
  return text.split("\n")[0]!.trim().slice(0, 80);
}

/** One finding per pattern per run: keep the most confident, cite all the evidence. */
function merge(findings: Finding[]): Finding[] {
  if (findings.length <= 1) return findings;
  const best = findings.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return [
    {
      ...best,
      evidenceSteps: [...new Set(findings.flatMap((f) => f.evidenceSteps))].sort((a, b) => a - b),
      // The same popup shown seven times would otherwise repeat one sentence seven times.
      explanation: [...new Set(findings.map((f) => f.explanation))].join(" "),
    },
  ];
}
