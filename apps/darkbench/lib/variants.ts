import { IN_SCOPE_PATTERNS, type PatternId } from "@darkscan/schema";

/** Patterns DarkBench can plant. Kept equal to the in-scope set so every detector has ground truth. */
export const BENCH_PATTERNS: readonly PatternId[] = IN_SCOPE_PATTERNS;

/**
 * Honest look-alikes: legitimate things that resemble a dark pattern. A detector that
 * flags one of these is wrong.
 */
export const DECOYS = [
  "real_countdown", // a sale timer counting down to a fixed deadline (midnight IST)
  "gst_at_checkout", // "18% GST added at checkout", disclosed on the product page
  "free_gift", // a ₹0 sample added at checkout
  "cookie_consent", // a one-off cookie popup with equal Accept/Reject buttons
  "link_decline", // decline shown as a normal-size, readable text link
  "signin_prompt", // "Sign in to continue" with a guest option right below
  "honest_stockout", // the advertised deal is out of stock, with no upsell
] as const;
export type DecoyId = (typeof DECOYS)[number];

/**
 * Wording pools. Variants 0–24 ("dev") draw from `dev`; variants 25–49 ("test") draw
 * only from `test`. Detectors may be tuned on dev results, never on test results, so
 * the test score shows how well they handle phrasing they weren't written for.
 */
const POOLS = {
  feeLabel: { dev: ["Platform fee", "Handling charge"], test: ["Service fee", "Order processing fee"] },
  dripFeeLabel: { dev: ["Convenience fee", "Payment handling fee"], test: ["Small cart fee", "Marketplace fee"] },
  urgency: { dev: ["Deal ends in", "Offer expires in"], test: ["Lightning deal ends in", "Price goes back up in"] },
  scarcity: { dev: ["Only 2 left in stock!", "Selling fast!"], test: ["Just 3 pieces left", "14 people bought this in the last hour"] },
  unavailable: { dev: ["Currently unavailable", "Out of stock"], test: ["Sold out", "Temporarily out of stock"] },
  newsletterTitle: { dev: ["Get 10% off your first order", "Unlock exclusive deals"], test: ["Join our VIP club", "Don't miss out on offers"] },
  newsletterDecline: { dev: ["Not now", "No thanks"], test: ["Maybe later", "I'm just browsing"] },
  newsletterShame: {
    dev: ["No, I hate saving money", "No thanks, I prefer paying full price"],
    test: ["I'll pay more, thanks", "I don't like discounts"],
  },
  upsellDecline: { dev: ["No thanks", "Skip"], test: ["Continue without protection", "Not interested"] },
  upsellShame: {
    dev: ["No thanks, I'll risk breaking it", "No, I don't care about my device"],
    test: ["I'll take my chances", "Leave my device unprotected"],
  },
  accountWall: {
    dev: ["Create an account to continue", "Sign in to continue"],
    test: ["Register to place your order", "Login required for checkout"],
  },
  guest: { dev: ["Continue as guest", "Checkout as guest"], test: ["Skip sign-in", "Buy without an account"] },
  adLabel: { dev: ["Sponsored", "Ad"], test: ["Promoted", "Featured partner"] },
  trick: {
    dev: [
      "Uncheck this box if you would prefer not to stop receiving offers on WhatsApp and SMS",
      "Tick here if you don't want to not hear about deals",
    ],
    test: [
      "Leave this checked unless you'd rather not miss out on member offers",
      "I do not wish to opt out of promotional calls",
    ],
  },
  optIn: { dev: ["Send me offers on WhatsApp", "Email me about deals"], test: ["Keep me posted on new arrivals", "Subscribe to SMS alerts"] },
} satisfies Record<string, { dev: string[]; test: string[] }>;

export type Words = { [K in keyof typeof POOLS]: string };
export type Split = "dev" | "test";

/** First phrase of each dev pool: used by variants 0 and 1 and by ?dp= links. */
export const DEFAULT_WORDS = Object.fromEntries(Object.entries(POOLS).map(([k, pool]) => [k, pool.dev[0]])) as Words;

export const VARIANT_COUNT = 50;
const TEST_FROM = 25;
const VARIANT_SEED = 2026;
const PATTERN_PROBABILITY = 0.4;
const DECOY_PROBABILITY = 0.5;

export type Variant = { id: number; split: Split; patterns: PatternId[]; decoys: DecoyId[]; words: Words };

// mulberry32: tiny deterministic PRNG so the variant set is identical on every machine.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Variant 0 is a clean shop (the false-positive control), variant 1 plants every
 * pattern; both use default wording and no decoys. The rest are random mixes of
 * patterns, decoys and wording. Patterns, decoys and wording use separate random
 * streams, so adding a wording pool doesn't reshuffle which patterns are planted.
 */
export function generateVariants(count = VARIANT_COUNT, seed = VARIANT_SEED): Variant[] {
  const patternRand = mulberry32(seed);
  const decoyRand = mulberry32(seed + 1);
  const variants: Variant[] = [
    { id: 0, split: "dev", patterns: [], decoys: [], words: DEFAULT_WORDS },
    { id: 1, split: "dev", patterns: [...BENCH_PATTERNS], decoys: [], words: DEFAULT_WORDS },
  ];
  for (let id = 2; id < count; id++) {
    const split: Split = id < TEST_FROM ? "dev" : "test";
    const wordRand = mulberry32(seed * 1000 + id);
    const words = Object.fromEntries(
      Object.entries(POOLS).map(([k, pool]) => [k, pool[split][Math.floor(wordRand() * pool[split].length)]]),
    ) as Words;
    variants.push({
      id,
      split,
      patterns: BENCH_PATTERNS.filter(() => patternRand() < PATTERN_PROBABILITY),
      decoys: DECOYS.filter(() => decoyRand() < DECOY_PROBABILITY),
      words,
    });
  }
  return variants;
}

export type BenchConfig = Pick<Variant, "patterns" | "decoys" | "words">;

/**
 * Reads the shop config from a query string:
 *   ?v=12               → variant 12 (patterns, decoys and wording)
 *   ?dp=drip_pricing,nagging   ?dp=all   ?dp=none   (default wording, no decoys)
 * Returns null when the query doesn't choose a config, so the caller keeps the stored one.
 */
export function configFromQuery(search: string): BenchConfig | null {
  const params = new URLSearchParams(search);
  const dp = params.get("dp");
  if (dp !== null) {
    const wanted = new Set(dp.split(",").map((s) => s.trim()));
    const patterns = dp === "all" ? [...BENCH_PATTERNS] : BENCH_PATTERNS.filter((p) => wanted.has(p));
    return { patterns, decoys: [], words: DEFAULT_WORDS };
  }
  const v = params.get("v");
  if (v !== null) {
    const variant = generateVariants().find((x) => x.id === Number(v));
    return variant ? { patterns: variant.patterns, decoys: variant.decoys, words: variant.words } : null;
  }
  return null;
}
