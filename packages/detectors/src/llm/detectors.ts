import type { AuditRun, Finding, Step } from "@darkscan/schema";
import { z } from "zod";
import { pageSteps } from "../util.ts";
import type { Llm } from "./ollama.ts";

// Prompts deliberately use their own examples, never DarkBench's wording, so benchmark
// scores reflect what the model understands rather than what it was shown.
const AUDITOR =
  "You audit Indian e-commerce websites for dark patterns under the CCPA Guidelines for " +
  "Prevention and Regulation of Dark Patterns, 2023. Judge only the evidence given. Be " +
  "conservative: answer true only when the evidence clearly shows the problem.";

const llmFinding = (pattern: Finding["pattern"], confidence: number, evidenceSteps: number[], explanation: string): Finding => ({
  pattern,
  status: confidence >= 0.7 ? "likely" : "review",
  confidence,
  detector: "llm",
  evidenceSteps: [...new Set(evidenceSteps)].sort((a, b) => a - b),
  explanation,
});

const clip = (text: string, max = 3000) => (text.length > max ? text.slice(0, max) + " …" : text);

/** Confirm shaming: the way to say no is worded to guilt or ridicule the shopper. */
export async function confirmShaming(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const byDecline = new Map<string, { title: string; steps: number[] }>();
  for (const step of run.steps) {
    const d = step.dialog;
    if (!d?.dismissedWith) continue;
    const entry = byDecline.get(d.dismissedWith) ?? { title: d.text.split("\n")[0]!, steps: [] };
    entry.steps.push(step.index);
    byDecline.set(d.dismissedWith, entry);
  }

  const Verdict = z.object({ shaming: z.boolean(), reason: z.string() });
  const system =
    `${AUDITOR}\n\nConfirm shaming means wording the option to decline so that it makes the ` +
    "user feel guilty, foolish or ashamed, for example by implying they don't care about " +
    "themselves or their family, want to waste money, or are making a bad choice. Plain " +
    'declines such as "No", "Cancel", "Close" or "Don\'t show again" are not confirm shaming. ' +
    'Example of confirm shaming: "No, I prefer to stay uninformed".';

  const findings: Finding[] = [];
  for (const [decline, { title, steps }] of byDecline) {
    const v = await llm.ask(system, `Popup title: "${title}"\nOption to decline: "${decline}"\nIs the option to decline confirm shaming?`, Verdict);
    if (v.shaming) {
      findings.push(llmFinding("confirm_shaming", 0.8, steps, `The "${title}" popup's decline option reads "${decline}". ${v.reason}`));
    }
  }
  return merge(findings);
}

/** Trick question: a consent checkbox whose wording hides what ticking it means. */
export async function trickQuestion(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const first = new Map<string, { checked: boolean; step: number }>();
  for (const step of run.steps) {
    for (const box of step.checkboxes) if (box.label && !first.has(box.label)) first.set(box.label, { checked: box.checked, step: step.index });
  }

  const Verdict = z.object({ confusing: z.boolean(), reason: z.string() });
  const system =
    `${AUDITOR}\n\nA trick question is a consent checkbox worded confusingly, for example with ` +
    "double or triple negatives, or phrased so a quick reader can't tell whether ticking it " +
    "means yes or no. A plain statement of what ticking does is not a trick question. " +
    'Example of a trick question: "Untick if you would not like us to avoid sharing your details". ' +
    'Example that is fine: "Notify me about price drops".';

  const findings: Finding[] = [];
  for (const [label, { checked, step }] of first) {
    const v = await llm.ask(system, `Checkbox label: "${label}"\nIs this checkbox a trick question?`, Verdict);
    if (!v.confusing) continue;
    findings.push(
      llmFinding(
        "trick_question",
        checked ? 0.85 : 0.7,
        [step],
        `Checkbox "${label}" is ${checked ? "pre-ticked and " : ""}confusingly worded. ${v.reason}`,
      ),
    );
  }
  return merge(findings);
}

// Click trackers that marketplaces put behind paid placements.
const AD_LINK = /[?&](sp_click|adclick|ad_?id|sponsored)=|\/sspa\/|\/aclk\b|doubleclick\.net|\/ads?\/click/i;
const OBVIOUS_LABEL = /\b(sponsored|ad|ads|advert|advertisement)\b/i;

/** Disguised advertisement: a link through an ad tracker whose card never says it's an ad. */
export async function disguisedAds(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const ads = new Map<string, { text: string; step: number }>();
  for (const step of run.steps) {
    for (const link of step.links) if (AD_LINK.test(link.href) && !ads.has(link.href)) ads.set(link.href, { text: link.text, step: step.index });
  }

  const Verdict = z.object({ disclosed: z.boolean(), label: z.string().nullable() });
  const system =
    `${AUDITOR}\n\nYou are shown the visible text of one product card that is a paid placement. ` +
    "Decide whether that text contains any label telling shoppers it is paid or promoted " +
    "content, in any wording. Product names, prices and ratings are not labels.";

  const findings: Finding[] = [];
  for (const [href, { text, step }] of ads) {
    if (OBVIOUS_LABEL.test(text)) continue;
    const v = await llm.ask(system, `Card text: "${text}"\nDoes it disclose that this is a paid placement?`, Verdict);
    if (v.disclosed) continue;
    findings.push(
      llmFinding("disguised_ads", 0.8, [step], `"${text}" links through an ad-click tracker (${new URL(href).search || href}) but shows no ad label.`),
    );
  }
  return merge(findings);
}

const ACCOUNT_WORDS = /account|sign.?in|log.?in|register|password/i;

/** Second opinion when the forced-action rule found nothing: is an account required to check out? */
export async function forcedAction(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const afterCart = run.steps.findIndex((s) => s.cart !== null);
  const candidates = pageSteps(run.steps.slice(Math.max(0, afterCart))).filter((s) => ACCOUNT_WORDS.test(s.visibleText));

  const Verdict = z.object({ accountRequired: z.boolean(), guestOption: z.string().nullable() });
  const system =
    `${AUDITOR}\n\nYou are shown the visible text of one page in a checkout flow. Decide whether ` +
    "the shopper is forced to create an account or log in before they can continue, with no " +
    "visible way to continue without one. If any option lets them continue without an account, " +
    "quote it as guestOption and answer false.";

  for (const step of candidates) {
    const v = await llm.ask(system, `Page text:\n${clip(step.visibleText)}\n\nIs an account required to continue?`, Verdict);
    if (v.accountRequired && !v.guestOption) {
      return [llmFinding("forced_action", 0.75, [step.index], `At step ${step.index} checkout cannot continue without an account, and no guest option is offered.`)];
    }
  }
  return [];
}

/** Second opinion when the false-urgency rule found nothing: the model finds the countdowns, code compares them. */
export async function falseUrgency(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const steps = pageSteps(run.steps);
  const Timers = z.object({ countdowns: z.array(z.object({ label: z.string(), remaining: z.string() })) });
  const system =
    `${AUDITOR}\n\nList every countdown timer on the page that shows how long a deal, offer or ` +
    "price will last, exactly as displayed (e.g. 04:59 or 01:02:03). Ignore delivery dates, " +
    "opening hours and clock times.";

  for (let i = 1; i < steps.length; i++) {
    const [before, after] = [steps[i - 1]!, steps[i]!];
    if (after.action !== "reload" || before.url !== after.url) continue;
    const ask = (s: Step) => llm.ask(system, `Page text:\n${clip(s.visibleText)}`, Timers);
    const [t1, t2] = [(await ask(before)).countdowns, (await ask(after)).countdowns];
    for (const a of t1) {
      const b = t2.find((t) => t.label === a.label) ?? (t1.length === 1 && t2.length === 1 ? t2[0] : undefined);
      const [s1, s2] = [seconds(a.remaining), b ? seconds(b.remaining) : null];
      if (s1 !== null && s2 !== null && s2 > s1) {
        return [
          llmFinding(
            "false_urgency",
            0.8,
            [before.index, after.index],
            `"${a.label}" went from ${a.remaining} to ${b!.remaining} after a page reload, so the countdown restarts instead of counting down.`,
          ),
        ];
      }
    }
  }
  return [];
}

function seconds(time: string): number | null {
  const parts = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!parts) return null;
  const [a, b, c] = [Number(parts[1]), Number(parts[2]), parts[3] === undefined ? null : Number(parts[3])];
  return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
}

function merge(findings: Finding[]): Finding[] {
  if (findings.length <= 1) return findings;
  const best = findings.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return [
    {
      ...best,
      evidenceSteps: [...new Set(findings.flatMap((f) => f.evidenceSteps))].sort((a, b) => a - b),
      explanation: [...new Set(findings.map((f) => f.explanation))].join(" "),
    },
  ];
}
