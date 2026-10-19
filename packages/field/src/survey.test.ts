import { describe, expect, it } from "vitest";
import { allows, cartRules, surveyShop, verdictFor } from "./survey.ts";
import type { Loader, ProbeVerdict } from "./survey.ts";
import { SHOPS } from "./shops.ts";

const ROBOTS = `
User-agent: *
Disallow: /cart
Disallow: /checkout/
Disallow: /gp/buy/
Disallow: /baggage-claim
Disallow: /wishlist
Allow: /cart/share
`;

const probe = (allowed: boolean): ProbeVerdict => ({ label: "cart", url: "https://x/cart", origin: "https://x", status: "ok", allowed });

describe("cartRules", () => {
  it("lists the disallowed paths that look like a cart or checkout", () => {
    expect(cartRules(ROBOTS)).toEqual(["/cart", "/checkout/", "/gp/buy/"]);
  });
  it("ignores a word that merely contains one, and Allow rules", () => {
    expect(cartRules(ROBOTS)).not.toContain("/baggage-claim");
    expect(cartRules(ROBOTS)).not.toContain("/cart/share");
  });
  it("uses the rules that apply to us, not another crawler's", () => {
    const text = "User-agent: gptbot\nDisallow: /cart\n\nUser-agent: *\nDisallow: /admin\n";
    expect(cartRules(text)).toEqual([]);
  });
});

describe("allows", () => {
  it("fails closed when robots.txt could not be read", () => {
    expect(allows({ status: "unreachable", text: "" }, "https://x/cart")).toBe(false);
  });
  it("allows everything when there is no robots.txt", () => {
    expect(allows({ status: "none", text: "" }, "https://x/cart")).toBe(true);
  });
  it("applies the longest matching rule", () => {
    expect(allows({ status: "ok", text: ROBOTS }, "https://x/cart")).toBe(false);
    expect(allows({ status: "ok", text: ROBOTS }, "https://x/cart/share")).toBe(true);
    expect(allows({ status: "ok", text: ROBOTS }, "https://x/product/1")).toBe(true);
  });
});

describe("verdictFor", () => {
  it("is closed when even the home page is disallowed", () => {
    expect(verdictFor({ ...probe(false), label: "home" }, [probe(true)])).toBe("closed");
  });
  it("is browse-only when a cart path is disallowed", () => {
    expect(verdictFor({ ...probe(true), label: "home" }, [probe(true), probe(false)])).toBe("browse-only");
  });
  it("is crawlable only when every tested path is allowed", () => {
    expect(verdictFor({ ...probe(true), label: "home" }, [probe(true)])).toBe("crawlable");
  });
});

describe("surveyShop", () => {
  const shop = {
    id: "s",
    name: "S",
    home: "https://www.s.test/",
    probes: [
      { label: "cart", url: "https://www.s.test/cart" },
      { label: "checkout", url: "https://checkout.s.test/pay" },
    ],
  };

  it("checks every host a shop uses, not only www", async () => {
    const seen: string[] = [];
    const load: Loader = async (origin) => {
      seen.push(origin);
      return origin.includes("checkout") ? { status: "ok", text: "User-agent: *\nDisallow: /pay\n" } : { status: "ok", text: "User-agent: *\nDisallow: /admin\n" };
    };
    const result = await surveyShop(shop, load);
    expect(seen).toEqual(["https://www.s.test", "https://checkout.s.test"]);
    expect(result.verdict).toBe("browse-only");
    expect(result.probes.map((p) => p.allowed)).toEqual([true, false]);
    expect(result.cartRules).toContain("/pay");
  });

  it("fetches each origin once", async () => {
    let calls = 0;
    const load: Loader = async () => (calls++, { status: "none", text: "" });
    const result = await surveyShop({ ...shop, probes: [shop.probes[0]!, { label: "checkout", url: "https://www.s.test/checkout" }] }, load);
    expect(calls).toBe(1);
    expect(result.verdict).toBe("crawlable");
  });
});

describe("the shop list", () => {
  it("has unique ids and https URLs", () => {
    expect(new Set(SHOPS.map((s) => s.id)).size).toBe(SHOPS.length);
    for (const shop of SHOPS) {
      for (const url of [shop.home, ...shop.probes.map((p) => p.url)]) expect(new URL(url).protocol).toBe("https:");
    }
  });
});
