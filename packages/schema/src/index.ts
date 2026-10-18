import { z } from "zod";

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

export const PatternIdSchema = z.enum(PATTERN_IDS as [PatternId, ...PatternId[]]);

/** Amounts are integer paise so price comparisons never hit float rounding. */
export const PriceLineSchema = z.object({
  label: z.string(),
  amountPaise: z.number().int(),
  kind: z.enum(["item", "shipping", "fee", "tax", "discount", "other"]),
});
export type PriceLine = z.infer<typeof PriceLineSchema>;

export const PriceSnapshotSchema = z.object({
  lines: z.array(PriceLineSchema),
  totalPaise: z.number().int().nullable(),
  /** Where the numbers came from: parsed from the DOM, or read off the screenshot by a VLM. */
  source: z.enum(["dom", "vlm"]),
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const CartItemSchema = z.object({
  name: z.string(),
  qty: z.number().int().positive(),
  unitPaise: z.number().int().nullable(),
  /** True when the crawler itself added this item; false items are candidates for basket sneaking. */
  addedByAgent: z.boolean(),
});
export type CartItem = z.infer<typeof CartItemSchema>;

/** How a button looked, so interface interference can compare accept vs decline. */
export const ButtonStyleSchema = z.object({
  text: z.string(),
  widthPx: z.number(),
  heightPx: z.number(),
  fontSizePx: z.number(),
  color: z.string(),
  /** The opaque colour behind the button text (its own, or the nearest ancestor's). */
  background: z.string(),
  /** A link that navigates somewhere, as opposed to a real button. A link is never a way to decline. */
  link: z.boolean().optional(),
});
export type ButtonStyle = z.infer<typeof ButtonStyleSchema>;

export const DialogSchema = z.object({
  text: z.string(),
  buttons: z.array(ButtonStyleSchema),
  /** The button the crawler pressed to decline. Null if it had to fall back to Escape. */
  dismissedWith: z.string().nullable(),
});
export type Dialog = z.infer<typeof DialogSchema>;

export const CheckboxSchema = z.object({ label: z.string(), checked: z.boolean() });

/** A visible link: its own text (e.g. a whole product card) and where it really goes. */
export const LinkSchema = z.object({ text: z.string(), href: z.string() });

export const StepSchema = z.object({
  index: z.number().int().nonnegative(),
  action: z.string(),
  url: z.string(),
  at: z.iso.datetime(),
  screenshot: z.string(),
  dom: z.string(),
  visibleText: z.string(),
  price: PriceSnapshotSchema.nullable(),
  cart: z.array(CartItemSchema).nullable(),
  /** Set on steps that captured a popup just before the crawler dismissed it. */
  dialog: DialogSchema.nullable(),
  checkboxes: z.array(CheckboxSchema),
  links: z.array(LinkSchema),
});
export type Step = z.infer<typeof StepSchema>;

export const AuditRunSchema = z.object({
  id: z.string(),
  target: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(["running", "completed", "not_auditable", "failed"]),
  /** Why a site could not be audited, e.g. "captcha" or "login required before browsing". */
  note: z.string().nullable(),
  trace: z.string().nullable(),
  steps: z.array(StepSchema),
});
export type AuditRun = z.infer<typeof AuditRunSchema>;

export const FindingSchema = z.object({
  pattern: PatternIdSchema,
  status: z.enum(["likely", "review", "ok"]),
  confidence: z.number().min(0).max(1),
  detector: z.enum(["rule", "llm"]),
  evidenceSteps: z.array(z.number().int().nonnegative()),
  explanation: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;
