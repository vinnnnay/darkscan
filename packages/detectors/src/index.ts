import type { AuditRun, Finding, PatternId } from "@darkscan/schema";
import * as llmDetectors from "./llm/detectors.ts";
import type { Llm } from "./llm/ollama.ts";
import { baitAndSwitch, basketSneaking, dripPricing, falseUrgency, forcedAction, interfaceInterference, nagging } from "./rules.ts";

type Detector = (run: AuditRun) => Finding[];
type LlmDetector = (run: AuditRun, llm: Llm) => Promise<Finding[]>;

export const RULE_DETECTORS: Partial<Record<PatternId, Detector>> = {
  drip_pricing: dripPricing,
  basket_sneaking: basketSneaking,
  false_urgency: falseUrgency,
  interface_interference: interfaceInterference,
  nagging,
  forced_action: forcedAction,
  bait_and_switch: baitAndSwitch,
};

/** Patterns only a language model can judge: whether wording guilt-trips, confuses or discloses. */
export const LLM_DETECTORS: Partial<Record<PatternId, LlmDetector>> = {
  confirm_shaming: llmDetectors.confirmShaming,
  trick_question: llmDetectors.trickQuestion,
  disguised_ads: llmDetectors.disguisedAds,
};

/** Asked only when the rule for the same pattern finds nothing, to catch wording the rule doesn't know. */
export const LLM_SECOND_OPINIONS: Partial<Record<PatternId, LlmDetector>> = {
  forced_action: llmDetectors.forcedAction,
  false_urgency: llmDetectors.falseUrgency,
};

export function detectAll(run: AuditRun): Finding[] {
  return Object.values(RULE_DETECTORS).flatMap((detect) => detect(run));
}

/** Rules first; then the model, for its own patterns and as a second opinion where a rule found nothing. */
export async function detectWithLlm(run: AuditRun, llm: Llm): Promise<Finding[]> {
  const findings = detectAll(run);
  for (const detect of Object.values(LLM_DETECTORS)) findings.push(...(await detect(run, llm)));
  for (const [pattern, detect] of Object.entries(LLM_SECOND_OPINIONS)) {
    if (!findings.some((f) => f.pattern === pattern && f.status === "likely")) findings.push(...(await detect(run, llm)));
  }
  return findings;
}

export { contrastRatio } from "./util.ts";
export { DEFAULT_MODEL, ollama, ollamaReady, type Llm } from "./llm/ollama.ts";
