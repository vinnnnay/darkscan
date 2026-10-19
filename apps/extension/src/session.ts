// The audit, as a value. No DOM and no extension APIs here, so it can be tested directly:
// observations in, the same AuditRun the crawler produces out, then the same rule detectors.
import { chooseDecline } from "@darkscan/crawler/extract";
import { parseCartRows, parsePriceText } from "@darkscan/crawler/extract";
import { baitAndSwitch, basketSneaking, dripPricing, falseUrgency, forcedAction, interfaceInterference, nagging } from "@darkscan/detectors/rules";
import type { AuditRun, ButtonStyle, Finding, Step } from "@darkscan/schema";

/** What a content script saw on one page, before any interpretation. */
export type Observation = {
  url: string;
  action: string;
  visibleText: string;
  /** Text of the order summary block, if the page has one. */
  summary: string;
  cartRows: string[];
  checkboxes: { label: string; checked: boolean }[];
  links: { text: string; href: string }[];
  dialog: { text: string; buttons: ButtonStyle[] } | null;
  /** The product the person just added to the cart, so a sneaked item can be told apart. */
  claim?: string;
};

export type Session = { origin: string; startedAt: string; steps: Step[]; claimed: string[] };

/** A long visit must not grow without bound; the oldest steps matter least. */
export const MAX_STEPS = 300;
const MAX_TEXT = 20_000;

export const newSession = (origin: string, startedAt: string): Session => ({ origin, startedAt, steps: [], claimed: [] });

/** The same popup or page seen twice running is one event, not two; SPAs fire these constantly. */
function repeats(previous: Step | undefined, o: Observation): boolean {
  return previous !== undefined && previous.url === o.url && previous.action === o.action && previous.visibleText === o.visibleText.slice(0, MAX_TEXT);
}

export function addObservation(session: Session, o: Observation, at: string): Session {
  const claimed = o.claim ? [...session.claimed, o.claim] : session.claimed;
  if (repeats(session.steps.at(-1), o)) return { ...session, claimed };

  const step: Step = {
    index: session.steps.length,
    action: o.action,
    url: o.url,
    at,
    // The rules read none of these two, so nothing of the page is kept beyond its visible text.
    screenshot: "",
    dom: "",
    visibleText: o.visibleText.slice(0, MAX_TEXT),
    price: parsePriceText(o.summary),
    cart: o.cartRows.length ? parseCartRows(o.cartRows, claimed) : null,
    // Nobody presses anything here: this is the button a cautious shopper would use to say no,
    // which is what the interference rule needs in order to compare it against the accept button.
    dialog: o.dialog ? { ...o.dialog, dismissedWith: chooseDecline(o.dialog.buttons)?.text ?? null } : null,
    checkboxes: o.checkboxes,
    links: o.links,
  };
  const steps = [...session.steps, step].slice(-MAX_STEPS);
  return { ...session, steps, claimed };
}

/** The shape the detectors expect. A visit is never "completed": the person may still be shopping. */
export function toRun(session: Session): AuditRun {
  return {
    id: `visit-${session.startedAt}`,
    target: session.origin,
    startedAt: session.startedAt,
    finishedAt: null,
    status: "running",
    note: null,
    trace: null,
    steps: session.steps,
  };
}

/**
 * The seven patterns that can be judged from evidence alone. Confirm shaming, trick questions
 * and disguised advertisements need a language model, which cannot run inside an extension,
 * so they are left out rather than guessed at.
 */
const RULES = [dripPricing, basketSneaking, falseUrgency, interfaceInterference, nagging, forcedAction, baitAndSwitch];

export function runRules(run: AuditRun): Finding[] {
  const order = { likely: 0, review: 1, ok: 2 } as const;
  return RULES.flatMap((rule) => rule(run)).sort((a, b) => order[a.status] - order[b.status] || b.confidence - a.confidence);
}

/** What the toolbar shows: only findings a person should actually look at. */
export const badgeFor = (findings: Finding[]): string => {
  const likely = findings.filter((f) => f.status === "likely").length;
  return likely > 0 ? String(likely) : "";
};
