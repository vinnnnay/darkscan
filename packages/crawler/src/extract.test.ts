import { describe, expect, it } from "vitest";
import type { ButtonStyle } from "@darkscan/schema";
import { chooseDecline, classifyLabel, parseAmountPaise, parseCartRows, parsePriceText } from "./extract.ts";

const btn = (text: string, widthPx: number, heightPx = 40): ButtonStyle => ({
  text,
  widthPx,
  heightPx,
  fontSizePx: 16,
  color: "rgb(0, 0, 0)",
  background: "rgb(255, 255, 255)",
});

describe("chooseDecline", () => {
  it("prefers known decline wording", () => {
    expect(chooseDecline([btn("Accept all", 100), btn("Reject all", 100)])?.text).toBe("Reject all");
  });

  it("falls back to the least prominent non-accept button", () => {
    const buttons = [btn("Subscribe", 300, 60), btn("Some unusual wording", 120, 20), btn("Learn more", 200, 30)];
    expect(chooseDecline(buttons)?.text).toBe("Some unusual wording");
  });

  it("never picks an accept action, even when it is the smallest", () => {
    expect(chooseDecline([btn("Add", 40), btn("Some unusual wording", 260)])?.text).toBe("Some unusual wording");
  });

  it("never falls back to a link that navigates somewhere", () => {
    const promo = { ...btn("Shop All Ethnic Wear", 120, 20), link: true };
    expect(chooseDecline([btn("Subscribe", 300, 60), promo])).toBeNull();
    expect(chooseDecline([btn("Subscribe", 300, 60), promo, btn("Some unusual wording", 150, 30)])?.text).toBe("Some unusual wording");
  });

  it("still honours a link that is plainly a decline", () => {
    expect(chooseDecline([{ ...btn("No thanks", 80, 14), link: true }, btn("Subscribe", 300, 60)])?.text).toBe("No thanks");
  });

  it("returns null when every button accepts", () => {
    expect(chooseDecline([btn("Subscribe", 100), btn("Accept", 100)])).toBeNull();
  });
});

describe("parseAmountPaise", () => {
  it("reads common rupee formats", () => {
    expect(parseAmountPaise("₹1,299")).toBe(129900);
    expect(parseAmountPaise("Rs. 99")).toBe(9900);
    expect(parseAmountPaise("INR 40.50")).toBe(4050);
    expect(parseAmountPaise("Coupon -₹50")).toBe(-5000);
    expect(parseAmountPaise("no price here")).toBeNull();
  });
});

describe("classifyLabel", () => {
  it.each([
    ["Subtotal", 100, "subtotal"],
    ["Grand Total", 100, "total"],
    ["Amount payable", 100, "total"],
    ["Delivery charges", 100, "shipping"],
    ["GST (18%)", 100, "tax"],
    ["Coupon SAVE50", -100, "discount"],
    ["Platform fee", 100, "fee"],
    ["Convenience fee", 100, "fee"],
    ["Purchase Protection", 100, "item"],
  ] as const)("%s → %s", (label, amount, kind) => {
    expect(classifyLabel(label, amount)).toBe(kind);
  });
});

describe("parsePriceText", () => {
  it("parses a tab-separated summary table with a FREE line", () => {
    const text = "Smart Watch S2\t₹2,499\nDelivery\tFREE\nPlatform fee\t₹19\nTotal\t₹2,518";
    expect(parsePriceText(text)).toEqual({
      lines: [
        { label: "Smart Watch S2", amountPaise: 249900, kind: "item" },
        { label: "Delivery", amountPaise: 0, kind: "shipping" },
        { label: "Platform fee", amountPaise: 1900, kind: "fee" },
      ],
      totalPaise: 251800,
      source: "dom",
    });
  });

  it("pairs a label line with the amount on the next line", () => {
    const snap = parsePriceText("Convenience fee\n₹99\nTotal\n₹457");
    expect(snap?.lines).toEqual([{ label: "Convenience fee", amountPaise: 9900, kind: "fee" }]);
    expect(snap?.totalPaise).toBe(45700);
  });

  it("takes the charged price when MRP is struck through", () => {
    expect(parsePriceText("MRP ₹1,999 ₹1,299")?.lines[0]?.amountPaise).toBe(129900);
  });

  it("skips subtotals and returns null for text without prices", () => {
    expect(parsePriceText("Subtotal: ₹500\nTotal: ₹540")?.lines).toEqual([]);
    expect(parsePriceText("Your cart is empty")).toBeNull();
  });
});

describe("parseCartRows", () => {
  it("reads quantities and flags items the agent did not add", () => {
    const rows = ["USB-C Cable 1m × 1", "Purchase Protection × 1", "USB-C Cable 1m × 1"];
    expect(parseCartRows(rows, ["USB-C Cable"])).toEqual([
      { name: "USB-C Cable 1m", qty: 1, unitPaise: null, addedByAgent: true },
      { name: "Purchase Protection", qty: 1, unitPaise: null, addedByAgent: false },
    ]);
  });

  it("claims the most similar row when the cart titles the product differently", () => {
    const rows = ["Add-on warranty × 1", "Samsung Galaxy M34 5G (Midnight Blue, 128GB) × 1"];
    const items = parseCartRows(rows, ["Galaxy M34"]);
    expect(items.map((i) => [i.name, i.addedByAgent])).toEqual([
      ["Add-on warranty", false],
      ["Samsung Galaxy M34 5G (Midnight Blue, 128GB)", true],
    ]);
  });

  it("still flags an extra row when names don't match at all", () => {
    const items = parseCartRows(["Totally different title × 1", "Protection plan × 1"], ["Phone"]);
    expect(items.filter((i) => !i.addedByAgent)).toHaveLength(1);
  });

  it("handles Qty: labels and inline prices", () => {
    expect(parseCartRows(["Laptop Stand Qty: 2 ₹1,798"], [])[0]).toEqual({
      name: "Laptop Stand",
      qty: 2,
      unitPaise: 179800,
      addedByAgent: false,
    });
  });
});
