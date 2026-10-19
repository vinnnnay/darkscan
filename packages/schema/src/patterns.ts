// The CCPA pattern catalogue on its own: plain data, no validation library. A browser extension
// or any other UI can read the names and numbers without pulling in the schemas.

/**
 * The 13 dark patterns specified in Annexure 1 of the CCPA "Guidelines for
 * Prevention and Regulation of Dark Patterns, 2023" (notified 30 November 2023).
 * The `annex` number is the item's number in that annexure.
 *
 * Checked on 2026-10-18 against the Gazette of India notification published at
 * https://ccpa.doca.gov.in/guidelines.php: all 13 numbers and names match.
 * (The Gazette spells item 13 "Rogue Malwares".)
 */
export const PATTERNS = {
  false_urgency: { annex: 1, name: "False urgency", inScope: true },
  basket_sneaking: { annex: 2, name: "Basket sneaking", inScope: true },
  confirm_shaming: { annex: 3, name: "Confirm shaming", inScope: true },
  forced_action: { annex: 4, name: "Forced action", inScope: true },
  subscription_trap: { annex: 5, name: "Subscription trap", inScope: false },
  interface_interference: { annex: 6, name: "Interface interference", inScope: true },
  bait_and_switch: { annex: 7, name: "Bait and switch", inScope: true },
  drip_pricing: { annex: 8, name: "Drip pricing", inScope: true },
  disguised_ads: { annex: 9, name: "Disguised advertisement", inScope: true },
  nagging: { annex: 10, name: "Nagging", inScope: true },
  trick_question: { annex: 11, name: "Trick question", inScope: true },
  saas_billing: { annex: 12, name: "SaaS billing", inScope: false },
  rogue_malware: { annex: 13, name: "Rogue malwares", inScope: false },
} as const;

export type PatternId = keyof typeof PATTERNS;

/**
 * What the guideline's own wording says that a detector's finding must not overstate, taken from
 * the notified text. Shown beside each finding in a report, so nobody reads more into it than it holds.
 */
export const PATTERN_NOTES: Partial<Record<PatternId, string>> = {
  false_urgency: "A real deadline is fine; the pattern is a false or restarting one. A claim like “Only 3 left” cannot be checked from outside.",
  basket_sneaking: "Free samples and necessary fees disclosed at the time of purchase are not basket sneaking. Check that the added item is paid for and was not chosen.",
  confirm_shaming: "Applies to wording meant to push a purchase or keep a subscription, about something the platform itself offers.",
  forced_action:
    "The guideline's examples are being forced to subscribe to a newsletter, install another app, or hand over details the purchase does not need. A required account may or may not count: check what the sign-up asks for.",
  drip_pricing: "A charge disclosed up front is fine, and a marketplace is not liable for price changes made by third-party sellers. Check that the charge really was not disclosed earlier.",
};

/** The guidelines' own caveat about Annexure 1, quoted so a report can repeat it. */
export const ANNEXURE_CAVEAT = "provide only guidance and shall not be construed as an interpretation of law or as a binding opinion";

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

/** Patterns DarkScan tries to detect. The rest need payment or installs to observe. */
export const IN_SCOPE_PATTERNS = PATTERN_IDS.filter((id) => PATTERNS[id].inScope);
