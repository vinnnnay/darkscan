import type { PatternId } from "@darkscan/schema";
import { findItem } from "./catalog.ts";
import type { DecoyId, Words } from "./variants.ts";

export type CartLine = { id: string; qty: number };
export type Stage = "cart" | "checkout";
export type OrderLine = { label: string; amount: number; kind: "item" | "shipping" | "fee" | "tax" };
export type PricingConfig = {
  patterns: ReadonlySet<PatternId>;
  decoys: ReadonlySet<DecoyId>;
  words: Pick<Words, "feeLabel" | "dripFeeLabel">;
};

export const SHIPPING_FEE = 40;
export const FREE_SHIPPING_MIN = 999;
/** Honest fee: disclosed on the product page and shown at every stage, unless drip pricing hides it. */
export const PLATFORM_FEE = 19;
/** Only exists in drip-pricing variants, and only at checkout. */
export const CONVENIENCE_FEE = 99;
/** gst_at_checkout decoy: disclosed on the product page, added at checkout. */
export const GST_RATE = 0.18;

export function computeOrder(cart: CartLine[], config: PricingConfig, stage: Stage) {
  const lines: OrderLine[] = [];
  let subtotal = 0;
  for (const { id, qty } of cart) {
    const item = findItem(id);
    if (!item) continue;
    subtotal += item.price * qty;
    lines.push({ label: qty > 1 ? `${item.name} × ${qty}` : item.name, amount: item.price * qty, kind: "item" });
  }
  if (lines.length === 0) return { lines, total: 0 };

  lines.push({
    label: "Delivery",
    amount: subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE,
    kind: "shipping",
  });

  const drip = config.patterns.has("drip_pricing");
  if (!drip || stage === "checkout") {
    lines.push({ label: config.words.feeLabel, amount: PLATFORM_FEE, kind: "fee" });
  }
  if (drip && stage === "checkout") {
    lines.push({ label: config.words.dripFeeLabel, amount: CONVENIENCE_FEE, kind: "fee" });
  }
  if (config.decoys.has("gst_at_checkout") && stage === "checkout") {
    lines.push({ label: "GST @ 18%", amount: Math.round(subtotal * GST_RATE), kind: "tax" });
  }

  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
}
