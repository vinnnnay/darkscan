import { describe, expect, it } from "vitest";
import { ANNEXURE_CAVEAT, IN_SCOPE_PATTERNS, PATTERNS, PATTERN_IDS, PATTERN_NOTES } from "./index.ts";

/**
 * Annexure 1 of the Guidelines for Prevention and Regulation of Dark Patterns, 2023, as numbered in the
 * Gazette of India notification (https://ccpa.doca.gov.in/guidelines.php), read on 2026-10-18.
 * If this test fails, a report would be citing the wrong item of the guidelines.
 */
const GAZETTE = [
  "False Urgency",
  "Basket sneaking",
  "Confirm shaming",
  "Forced action",
  "Subscription trap",
  "Interface interference",
  "Bait and switch",
  "Drip pricing",
  "Disguised advertisement",
  "Nagging",
  "Trick Question",
  "Saas billing",
  "Rogue Malwares",
];

describe("the patterns match the notified guidelines", () => {
  it("has the 13 items, numbered and named as in the Gazette", () => {
    const ours = PATTERN_IDS.map((id) => [PATTERNS[id].annex, PATTERNS[id].name.toLowerCase()] as const).sort((a, b) => a[0] - b[0]);
    expect(ours).toEqual(GAZETTE.map((name, i) => [i + 1, name.toLowerCase()]));
  });

  it("does not try to test the three patterns that need a payment or an install", () => {
    expect(PATTERN_IDS.filter((id) => !PATTERNS[id].inScope).map((id) => PATTERNS[id].annex)).toEqual([5, 12, 13]);
    expect(IN_SCOPE_PATTERNS).toHaveLength(10);
  });

  it("only has notes for patterns that exist, and quotes the Annexure's own caveat", () => {
    for (const id of Object.keys(PATTERN_NOTES)) expect(PATTERN_IDS).toContain(id);
    expect(ANNEXURE_CAVEAT).toMatch(/guidance/);
  });
});
