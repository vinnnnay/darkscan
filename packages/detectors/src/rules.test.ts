import type { AuditRun, ButtonStyle, PriceLine, Step } from "@darkscan/schema";
import { describe, expect, it } from "vitest";
import { baitAndSwitch, basketSneaking, dripPricing, falseUrgency, forcedAction, interfaceInterference, nagging } from "./rules.ts";
import { contrastRatio } from "./util.ts";

function step(partial: Partial<Step>, index = 0): Step {
  return {
    index,
    action: "goto /",
    url: "https://shop.test/",
    at: "2026-10-18T00:00:00.000Z",
    screenshot: "s.png",
    dom: "s.html",
    visibleText: "",
    price: null,
    cart: null,
    dialog: null,
    checkboxes: [],
    links: [],
    ...partial,
  };
}

function run(steps: Partial<Step>[], note: string | null = null): AuditRun {
  return {
    id: "test",
    target: "https://shop.test/",
    startedAt: "2026-10-18T00:00:00.000Z",
    finishedAt: "2026-10-18T00:01:00.000Z",
    status: "completed",
    note,
    trace: null,
    steps: steps.map((s, i) => step(s, i)),
  };
}

const price = (...lines: [string, number, PriceLine["kind"]][]) => ({
  lines: lines.map(([label, rupees, kind]) => ({ label, amountPaise: rupees * 100, kind })),
  totalPaise: lines.reduce((sum, [, r]) => sum + r * 100, 0),
  source: "dom" as const,
});

const button = (text: string, w: number, h: number, extra: Partial<ButtonStyle> = {}): ButtonStyle => ({
  text,
  widthPx: w,
  heightPx: h,
  fontSizePx: 16,
  color: "rgb(28, 31, 36)",
  background: "rgb(255, 255, 255)",
  ...extra,
});

describe("dripPricing", () => {
  it("flags a fee that appears at checkout without earlier mention", () => {
    const findings = dripPricing(
      run([
        { visibleText: "Cable ₹299", price: price(["Cable", 299, "item"]) },
        { price: price(["Cable", 299, "item"], ["Convenience fee", 99, "fee"]) },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: "likely", evidenceSteps: [0, 1] });
    expect(findings[0]!.explanation).toContain("Convenience fee");
  });

  it("accepts a fee that was disclosed on an earlier page", () => {
    const findings = dripPricing(
      run([
        { visibleText: "Cable ₹299 + ₹19 platform fee per order", price: price(["Cable", 299, "item"]) },
        { price: price(["Cable", 299, "item"], ["Platform fee", 19, "fee"]) },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("accepts a charge disclosed in different words", () => {
    const findings = dripPricing(
      run([
        { visibleText: "Prices exclude GST. 18% GST is added at checkout.", price: price(["Cable", 299, "item"]) },
        { price: price(["Cable", 299, "item"], ["GST @ 18%", 54, "tax"]) },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("does not treat scattered words on different lines as a disclosure", () => {
    const findings = dripPricing(
      run([
        { visibleText: "Fast checkout\nPay by card for convenience", price: price(["Cable", 299, "item"]) },
        { price: price(["Cable", 299, "item"], ["Convenience fee", 99, "fee"]) },
      ]),
    );
    expect(findings).toHaveLength(1);
  });

  it("accepts charges already present in the first price summary", () => {
    const p = price(["Cable", 299, "item"], ["Delivery", 40, "shipping"]);
    expect(dripPricing(run([{ price: p }, { price: p }]))).toEqual([]);
  });

  it("ignores extra items, which are basket sneaking rather than fees", () => {
    const findings = dripPricing(
      run([{ price: price(["Cable", 299, "item"]) }, { price: price(["Cable", 299, "item"], ["Protection", 99, "item"]) }]),
    );
    expect(findings).toEqual([]);
  });
});

describe("basketSneaking", () => {
  const item = (name: string, addedByAgent: boolean) => ({ name, qty: 1, unitPaise: null, addedByAgent });

  it("flags paid items the agent didn't add, once each", () => {
    const cart = [item("Cable", true), item("Protection", false)];
    const p = price(["Cable", 299, "item"], ["Protection", 99, "item"]);
    const findings = basketSneaking(run([{ cart: cart.slice(0, 1) }, { cart, price: p }, { cart, price: p }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ status: "likely", evidenceSteps: [1] });
    expect(findings[0]!.explanation).toContain("adds ₹99");
  });

  it("ignores free items", () => {
    const cart = [item("Cable", true), item("Free sample: Cable organiser", false)];
    const p = price(["Cable", 299, "item"], ["Free sample: Cable organiser", 0, "item"]);
    expect(basketSneaking(run([{ cart, price: p }]))).toEqual([]);
  });

  it("asks for review when the item's price is not shown", () => {
    expect(basketSneaking(run([{ cart: [item("Mystery add-on", false)] }]))[0]?.status).toBe("review");
  });
});

describe("falseUrgency", () => {
  it("flags a countdown that resets on reload", () => {
    const findings = falseUrgency(
      run([
        { visibleText: "Deal ends in 09:56\nOnly 2 left in stock!" },
        { action: "reload", visibleText: "Deal ends in 09:59\nOnly 2 left in stock!" },
      ]),
    );
    expect(findings[0]).toMatchObject({ status: "likely", evidenceSteps: [0, 1] });
    expect(findings[0]!.explanation).toContain("Only 2 left");
  });

  it("accepts a countdown that keeps counting down across reloads", () => {
    const findings = falseUrgency(
      run([{ visibleText: "Sale ends in 01:59:30" }, { action: "reload", visibleText: "Sale ends in 01:59:20" }]),
    );
    expect(findings).toEqual([]);
  });

  it("only asks for review on a bare scarcity claim", () => {
    expect(falseUrgency(run([{ visibleText: "Only 3 left!" }]))[0]?.status).toBe("review");
  });

  it("ignores times that aren't countdowns", () => {
    expect(falseUrgency(run([{ visibleText: "Delivery by 10:30" }, { action: "reload", visibleText: "Delivery by 11:30" }]))).toEqual([]);
  });
});

describe("interfaceInterference", () => {
  const dialog = (accept: ButtonStyle, decline: ButtonStyle) => ({
    dialog: { text: "Protect your purchase?\n…", buttons: [accept, decline], dismissedWith: decline.text },
  });

  it("flags a huge accept button next to a faint, tiny decline", () => {
    const findings = interfaceInterference(
      run([dialog(button("Add", 372, 62), button("No thanks", 154, 14, { fontSizePx: 11.2, color: "rgb(196, 200, 206)" }))]),
    );
    expect(findings[0]).toMatchObject({ status: "likely" });
    expect(findings[0]!.explanation).toMatch(/10\.7× the size.*contrast of 1\.\d:1/);
  });

  it("says each thing once, even when the same popup was shown several times", () => {
    const d = dialog(button("Add", 372, 62), button("No thanks", 154, 14, { fontSizePx: 11.2, color: "rgb(196, 200, 206)" }));
    const [finding] = interfaceInterference(run([d, d, d, d]));
    expect(finding!.explanation.match(/popup/g)).toHaveLength(1);
    expect(finding!.evidenceSteps).toEqual([0, 1, 2, 3]);
  });

  it("accepts comparable buttons", () => {
    expect(interfaceInterference(run([dialog(button("Subscribe", 110, 44), button("Not now", 90, 44))]))).toEqual([]);
  });
});

describe("nagging", () => {
  const popup = (title: string) => ({ dialog: { text: title, buttons: [], dismissedWith: "Not now" } });

  it("flags a popup that returns after being declined", () => {
    const findings = nagging(run([popup("Get 10% off"), {}, popup("Get 10% off"), popup("Get 10% off")]));
    expect(findings[0]).toMatchObject({ status: "likely", evidenceSteps: [0, 2, 3] });
  });

  it("accepts popups shown once each", () => {
    expect(nagging(run([popup("Get 10% off"), popup("Protect your purchase?")]))).toEqual([]);
  });
});

describe("forcedAction", () => {
  it("flags an account wall without a guest option", () => {
    const findings = forcedAction(run([{ visibleText: "Create an account to continue\nEmail" }], "Stopped: continuing requires creating an account"));
    expect(findings[0]!.explanation).toContain("audit stopped here");
  });

  it("accepts sign-up when guest checkout is offered", () => {
    expect(forcedAction(run([{ visibleText: "Sign in to continue\nor Continue as guest" }]))).toEqual([]);
  });
});

describe("baitAndSwitch", () => {
  it("flags an advertised deal that pushes a pricier item", () => {
    const findings = baitAndSwitch(
      run([{ action: "click Earbuds at just ₹499!", visibleText: "Earbuds ₹499\nCurrently unavailable\nTry Earbuds Pro at ₹1,299" }]),
    );
    expect(findings[0]).toMatchObject({ status: "likely" });
  });

  it("only asks for review on a plain stock-out", () => {
    expect(baitAndSwitch(run([{ action: "click Earbuds ₹499", visibleText: "Earbuds ₹499\nOut of stock" }]))[0]?.status).toBe("review");
  });
});

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 0);
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(255, 255, 255)")).toBeCloseTo(1, 5);
  });
});
