import type { Finding, PatternId, Step } from "@darkscan/schema";

export const rupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN");

export const isPopup = (step: Step) => step.dialog !== null;

/** Steps that show the page itself rather than a popup on top of it. */
export const pageSteps = (steps: Step[]) => steps.filter((s) => !isPopup(s));

export function finding(
  pattern: PatternId,
  confidence: number,
  evidenceSteps: number[],
  explanation: string,
): Finding {
  return {
    pattern,
    status: confidence >= 0.7 ? "likely" : "review",
    confidence,
    detector: "rule",
    evidenceSteps: [...new Set(evidenceSteps)].sort((a, b) => a - b),
    explanation,
  };
}

function parseRgb(css: string): [number, number, number] | null {
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]: [number, number, number]) {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two CSS colours, from 1 (invisible) to 21 (black on white). */
export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseRgb(fg);
  const b = parseRgb(bg);
  if (!a || !b) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
