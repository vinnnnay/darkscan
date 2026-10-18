import type { PatternId } from "@darkscan/schema";
import { describe, expect, it } from "vitest";
import { CONVENIENCE_FEE, PLATFORM_FEE, SHIPPING_FEE, computeOrder, type PricingConfig } from "./pricing.ts";
import { DEFAULT_WORDS, type DecoyId } from "./variants.ts";

const config = (patterns: PatternId[] = [], decoys: DecoyId[] = []): PricingConfig => ({
  patterns: new Set(patterns),
  decoys: new Set(decoys),
  words: DEFAULT_WORDS,
});
const none = config();
const drip = config(["drip_pricing"]);
const cable = [{ id: "usb-cable", qty: 1 }]; // ₹299, below free delivery
const watch = [{ id: "smart-watch", qty: 1 }]; // ₹2,499, free delivery

describe("computeOrder", () => {
  it("returns an empty order for an empty cart", () => {
    expect(computeOrder([], none, "checkout")).toEqual({ lines: [], total: 0 });
  });

  it("charges the same disclosed total at cart and checkout when drip pricing is off", () => {
    const cart = computeOrder(cable, none, "cart");
    const checkout = computeOrder(cable, none, "checkout");
    expect(cart.total).toBe(299 + SHIPPING_FEE + PLATFORM_FEE);
    expect(checkout).toEqual(cart);
  });

  it("waives delivery above the free-shipping threshold", () => {
    expect(computeOrder(watch, none, "cart").total).toBe(2499 + PLATFORM_FEE);
  });

  it("hides fees until checkout when drip pricing is on", () => {
    const cart = computeOrder(watch, drip, "cart");
    const checkout = computeOrder(watch, drip, "checkout");
    expect(cart.lines.some((l) => l.kind === "fee")).toBe(false);
    expect(checkout.total - cart.total).toBe(PLATFORM_FEE + CONVENIENCE_FEE);
  });

  it("adds disclosed GST at checkout only for the gst_at_checkout decoy", () => {
    const gst = config([], ["gst_at_checkout"]);
    expect(computeOrder(watch, gst, "cart").lines.some((l) => l.kind === "tax")).toBe(false);
    expect(computeOrder(watch, gst, "checkout").lines.at(-1)).toEqual({ label: "GST @ 18%", amount: 450, kind: "tax" });
  });
});
