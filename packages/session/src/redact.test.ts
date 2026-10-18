import { describe, expect, it } from "vitest";
import { makeRedactor, parseTerms } from "./redact.ts";

const redact = makeRedactor();

describe("makeRedactor", () => {
  it.each([
    ["Email me at asha.verma@example.com please", "Email me at [email] please"],
    ["Pay to asha@okaxis or 98765@ybl", "Pay to [upi id] or [upi id]"],
    ["Call +91 98765 43210 or 9876543210 or 098765-43210", "Call [phone] or [phone] or [phone]"],
    ["Card 4111 1111 1111 1111 expires 12/28", "Card [card number] expires 12/28"],
    ["Aadhaar 1234 5678 9012", "Aadhaar [id number]"],
    ["PAN ABCDE1234F on file", "PAN [PAN] on file"],
    ["Your OTP is 482913", "Your OTP is [code]"],
    ["Enter CVV: 123", "Enter CVV: [code]"],
    ["Deliver to PIN code 110001", "Deliver to PIN code [pin]"],
    ["Pincode: 560001", "Pincode: [pin]"],
  ])("masks %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("leaves prices, quantities, delivery times and product ids alone", () => {
    const harmless = [
      "Total ₹1,299 + ₹40 delivery",
      "Rs. 1,847.58 (MRP 2,679)",
      "Generally delivered in 5 - 9 days",
      "Thickness 8 mm, 0-12 Years",
      "Item 16310907 Qty: 2",
      "SDL698926428 · SUPC 16310907",
      "Save ₹1,00,000 on 4 items",
      "Order of 10 pieces at 99.00 each",
    ];
    for (const text of harmless) expect(redact(text)).toBe(text);
  });

  it("masks words the person lists, ignoring case, and treats them literally", () => {
    const own = makeRedactor(["Asha Verma", "12 MG Road", "a.b"]);
    expect(own("Hello ASHA VERMA, ship to 12 mg road")).toBe("Hello [redacted], ship to [redacted]");
    expect(own("axb")).toBe("axb"); // "a.b" is not a pattern
  });

  it("ignores terms too short to be safe", () => {
    expect(makeRedactor(["ab", " ", ""])("a table and a cab")).toBe("a table and a cab");
  });

  it("masks a value in the middle of markup too", () => {
    expect(redact('<a href="mailto:me@x.com">9876543210</a>')).toBe('<a href="mailto:[email]">[phone]</a>');
  });
});

describe("parseTerms", () => {
  it("splits on commas and trims", () => {
    expect(parseTerms(" Asha Verma , 9876543210,, 12 MG Road ")).toEqual(["Asha Verma", "9876543210", "12 MG Road"]);
    expect(parseTerms(undefined)).toEqual([]);
  });
});
