import { describe, expect, it } from "vitest";
import { targetFor } from "./agent.ts";
import type { Candidate, PageFacts } from "./observe.ts";
import { classifyPage, decide, findAdvertisedDeal, identity, pathOf, shortlist, variantKey } from "./policy.ts";

let nextId = 0;
const c = (text: string, extra: Partial<Candidate> = {}): Candidate => ({
  id: nextId++,
  kind: "link",
  text,
  href: `https://shop.test/${encodeURIComponent(text)}`,
  hasPrice: false,
  disabled: false,
  inNav: false,
  ...extra,
});
const btn = (text: string, extra: Partial<Candidate> = {}) => c(text, { kind: "button", href: null, ...extra });

const page = (path: string, extra: Partial<PageFacts> = {}): PageFacts => ({
  url: `https://shop.test${path}`,
  title: "",
  heading: "",
  text: "",
  candidates: [],
  cartRows: 0,
  hasPasswordField: false,
  paymentOverlay: false,
  formFields: 0,
  variantOptions: [],
  ...extra,
});

describe("classifyPage", () => {
  it("recognises each page of the flow", () => {
    expect(classifyPage(page("/"))).toBe("listing");
    expect(classifyPage(page("/p/1", { candidates: [btn("Add to cart")] }))).toBe("product");
    expect(classifyPage(page("/cart/", { cartRows: 1 }))).toBe("cart");
    expect(classifyPage(page("/checkout/", { formFields: 3, cartRows: 1 }))).toBe("checkout");
    expect(classifyPage(page("/checkout/", { hasPasswordField: true, formFields: 0, text: "Sign in to continue" }))).toBe("account_wall");
    expect(classifyPage(page("/payment/"))).toBe("payment");
  });

  it("treats an open payment-provider overlay as the payment gate, even on a cart-looking page", () => {
    expect(classifyPage(page("/cart/addToCart", { paymentOverlay: true, cartRows: 0, candidates: [btn("PROCEED TO CHECKOUT")] }))).toBe("payment");
    expect(decide("payment", page("/cart/addToCart", { paymentOverlay: true }), { addedToCart: true })).toHaveProperty("stop");
  });

  it("calls a page with a grid of add buttons a listing, and one with a single add button a product", () => {
    const grid = page("/diapering/1/0/0", { candidates: [btn("ADD TO CART"), btn("ADD TO CART"), btn("ADD TO CART"), btn("ADD TO CART")] });
    expect(classifyPage(grid)).toBe("listing");
    expect(classifyPage(page("/p/1", { candidates: [btn("ADD TO CART"), btn("ADD TO CART")] }))).toBe("product");
  });

  it("does not mistake a product page with a search box and a pincode field for a checkout form", () => {
    const f = page("/product/slippers/123", { formFields: 1, candidates: [btn("ADD TO CART")] });
    expect(classifyPage(f)).toBe("product");
  });

  it("needs address-like fields to call a page a checkout form", () => {
    expect(classifyPage(page("/checkout/", { formFields: 2, cartRows: 1 }))).toBe("checkout");
    expect(classifyPage(page("/anything", { formFields: 2, cartRows: 1 }))).toBe("cart");
  });

  it("recognises an account page by its password field, even under a neutral heading", () => {
    const f = page("/checkout/", { hasPasswordField: true, formFields: 0, text: "How would you like to check out?" });
    expect(classifyPage(f)).toBe("account_wall");
  });

  it("treats a login form as an account wall only when no cart is listed", () => {
    expect(classifyPage(page("/cart/", { hasPasswordField: true, cartRows: 2, text: "Log in" }))).toBe("cart");
  });
});

describe("decide", () => {
  it("opens a priced, non-nav product link on a listing and skips sponsored cards", () => {
    const f = page("/", {
      candidates: [
        c("Home", { inNav: true }),
        c("Sponsored Phone case ₹399", { hasPrice: true }),
        c("Laptop Stand ₹899", { hasPrice: true }),
      ],
    });
    const choice = decide("listing", f, { addedToCart: false });
    expect(choice).toMatchObject({ role: "product", candidate: { text: "Laptop Stand ₹899" } });
  });

  it("after adding to the cart, goes to the cart instead of browsing on", () => {
    const f = page("/p/1", {
      candidates: [c("Silk Kurta Set ₹899", { hasPrice: true, href: "https://shop.test/silk/p-mp1" }), c("My Shopping Bag", { inNav: true })],
    });
    expect(decide("listing", f, { addedToCart: false })).toMatchObject({ role: "product" });
    expect(decide("listing", f, { addedToCart: true })).toMatchObject({ role: "cart", candidate: { text: "My Shopping Bag" } });
  });

  it("prefers a product-page URL, and never opens a search or category page as a product", () => {
    const f = page("/", {
      candidates: [
        c("Best deals on kurta sets ₹399", { hasPrice: true, href: "https://shop.test/search/page-1?q=best%20deals" }),
        c("Silk Kurta Set ₹899", { hasPrice: true, href: "https://shop.test/silk-kurta-set/p-mp000000123" }),
        c("Cotton Kurta ₹499", { hasPrice: true, href: "https://shop.test/cotton-kurta/p-mp000000456" }),
      ],
    });
    expect(decide("listing", f, { addedToCart: false })).toMatchObject({ candidate: { text: "Silk Kurta Set ₹899" } });
    const onlySearch = page("/", { candidates: [c("Sale ₹399 kurtas", { hasPrice: true, href: "https://shop.test/category/kurtas" })] });
    expect(decide("listing", onlySearch, { addedToCart: false })).toBeNull();
  });

  it("does not take a footer's list of payment methods for a payment page", () => {
    const f = page("/", { text: "Payment options: Visa, Mastercard, Net Banking, Cash on Delivery" });
    expect(classifyPage(f)).toBe("listing");
    expect(classifyPage(page("/", { text: "Enter card number and CVV" }))).toBe("payment");
  });

  it("counts cart rows by their Remove button, not a search page's 'Remove all filters'", () => {
    // classification relies on cartRows, which the observer computes; see the browser test
    expect(classifyPage(page("/search", { cartRows: 0, text: "Remove all filters" }))).toBe("listing");
  });

  it("skips product links it has already opened", () => {
    const first = c("Cable ₹299", { hasPrice: true });
    const second = c("Laptop Stand ₹899", { hasPrice: true });
    const f = page("/", { candidates: [first, second] });
    const avoid = new Set([pathOf(first.href)!]);
    expect(decide("listing", f, { addedToCart: false, avoid })).toMatchObject({ candidate: { text: "Laptop Stand ₹899" } });
    expect(decide("listing", f, { addedToCart: false, avoid: new Set([...avoid, pathOf(second.href)!]) })).toBeNull();
  });

  it("opens a product card that is not a link, and remembers it by its text", () => {
    const card = c("Bluetooth Earbuds Pro ₹269", { kind: "card", href: null, hasPrice: true });
    const f = page("/", { candidates: [c("Home", { inNav: true }), card] });
    expect(decide("listing", f, { addedToCart: false })).toMatchObject({ role: "product", candidate: { kind: "card" } });
    expect(decide("listing", f, { addedToCart: false, avoid: new Set([identity(card)]) })).toBeNull();
  });

  it("prefers the shop's GO TO CART button after an add, over the header link", () => {
    const f = page("/p/1", { candidates: [c("1 Cart", { inNav: true }), btn("GO TO CART"), btn("ADD TO CART")] });
    expect(decide("product", f, { addedToCart: true })).toMatchObject({ role: "cart", candidate: { text: "GO TO CART" } });
  });

  it("falls back to the header cart link, and skips a cart control that already failed on this page", () => {
    const header = c("1 Cart", { inNav: true });
    const f = page("/p/1", { candidates: [header, btn("GO TO CART"), btn("ADD TO CART")] });
    const failed = new Set([`${f.url}|${identity(btn("GO TO CART"))}`]);
    expect(decide("product", f, { addedToCart: true, avoid: failed })).toMatchObject({ candidate: { text: "1 Cart" } });
  });

  it("adds to cart first, then opens the cart", () => {
    const f = page("/p/1", { candidates: [btn("Buy Now"), btn("Add to cart"), c("Cart (1)", { inNav: true })] });
    expect(decide("product", f, { addedToCart: false })).toMatchObject({ role: "add", candidate: { text: "Add to cart" } });
    expect(decide("product", f, { addedToCart: true })).toMatchObject({ role: "cart", candidate: { text: "Cart (1)" } });
  });

  it("never picks a payment control, even when it is the only match", () => {
    const f = page("/cart/", { cartRows: 1, candidates: [btn("Place order")] });
    expect(decide("cart", f, { addedToCart: true })).toBeNull();
    const g = page("/cart/", { cartRows: 1, candidates: [btn("Proceed to pay"), btn("Proceed to checkout")] });
    expect(decide("cart", g, { addedToCart: true })).toMatchObject({ candidate: { text: "Proceed to checkout" } });
  });

  it("takes a guest option at an account wall, and stops when there isn't one", () => {
    const wall = (candidates: Candidate[]) => page("/checkout/", { hasPasswordField: true, candidates });
    expect(decide("account_wall", wall([btn("Create account"), btn("Buy without an account")]), { addedToCart: true })).toMatchObject({
      role: "guest",
    });
    expect(decide("account_wall", wall([btn("Create account")]), { addedToCart: true })).toMatchObject({ stop: expect.stringContaining("no guest option") });
  });

  it("stops at checkout and payment pages, but only once something is in the cart", () => {
    expect(decide("checkout", page("/checkout/"), { addedToCart: true })).toHaveProperty("stop");
    expect(decide("payment", page("/payment/"), { addedToCart: true })).toHaveProperty("stop");
    expect(decide("checkout", page("/checkout/"), { addedToCart: false })).toBeNull();
    expect(decide("payment", page("/payment/"), { addedToCart: false })).toBeNull();
    expect(decide("account_wall", page("/login"), { addedToCart: false })).toBeNull();
  });

  it("treats an empty cart page as a failure, not as success", () => {
    const decision = decide("cart", page("/cart/", { candidates: [btn("Continue shopping")] }), { addedToCart: true });
    expect(decision).toMatchObject({ stop: expect.stringContaining("cart is empty") });
  });

  it("picks a size first, once, then adds to cart", () => {
    const f = page("/p/1", { variantOptions: ["6", "9", "10"], candidates: [btn("ADD TO CART")] });
    expect(decide("product", f, { addedToCart: false })).toMatchObject({ role: "variant", option: "6" });
    const after = new Set([variantKey("6")]);
    expect(decide("product", f, { addedToCart: false, avoid: after })).toMatchObject({ role: "add" });
  });

  it("returns null when no rule fits, so the model gets a say", () => {
    expect(decide("product", page("/p/1", { candidates: [btn("Get it")] }), { addedToCart: false })).toBeNull();
  });
});

describe("categories", () => {
  const home = (extra: Partial<PageFacts> = {}) =>
    page("/", {
      candidates: [
        c("Support", { href: "https://shop.test/contactus" }),
        c("Track Order", { href: "https://shop.test/alltrackorder" }),
        c("TOYS", { href: "https://shop.test/toys-and-gaming/5/0/0?sort=bestseller" }),
        c("Lucky Draw", { href: "https://shop.test/contests/lucky-draw/" }),
        c("DIAPERING", { href: "https://shop.test/diapering/1/0/0?sort=bestseller" }),
      ],
      ...extra,
    });

  it("opens a department when the page shows no products, skipping support, tracking and contests", () => {
    expect(decide("listing", home(), { addedToCart: false })).toMatchObject({ role: "category", candidate: { text: "TOYS" } });
  });

  it("moves on to the next department once one has been tried", () => {
    const toys = home().candidates.find((x) => x.text === "TOYS")!;
    expect(decide("listing", home(), { addedToCart: false, avoid: new Set([identity(toys)]) })).toMatchObject({ candidate: { text: "DIAPERING" } });
  });

  it("prefers a product over a department", () => {
    const withProduct = home({ candidates: [...home().candidates, c("Silk Kurta ₹899", { hasPrice: true, href: "https://shop.test/silk/p-mp1" })] });
    expect(decide("listing", withProduct, { addedToCart: false })).toMatchObject({ role: "product" });
  });

  it("does not follow a department on another site", () => {
    const away = page("/", { candidates: [c("Fashion", { href: "https://other.test/c/fashion/" })] });
    expect(decide("listing", away, { addedToCart: false })).toBeNull();
  });
});

describe("targetFor", () => {
  it("finds product links by URL, labels by exact text, and everything else by role and name", () => {
    expect(targetFor(c("Laptop Stand ₹899", { hasPrice: true, href: "https://shop.test/p/stand?x=1" }))).toEqual({ href: "/p/stand?x=1" });
    expect(targetFor(c("ADD TO CART", { kind: "label", href: null }))).toEqual({ text: "ADD TO CART", exact: true });
    expect(targetFor(btn("Cart (3)"))).toEqual({ role: "button", name: "Cart" });
    expect(targetFor(c("1 Cart", { inNav: true }))).toEqual({ role: "link", name: "Cart" });
    expect(targetFor(c("Cart 12", { inNav: true }))).toEqual({ role: "link", name: "Cart" });
  });

  it("never targets a javascript: link by its URL, which would match every such link", () => {
    const link = c("PROCEED TO CHECKOUT", { hasPrice: true, href: "javascript:void(0)" });
    expect(targetFor(link)).toEqual({ role: "link", name: "PROCEED TO CHECKOUT" });
  });

  it("clicks a link-less product card by its title", () => {
    expect(targetFor(c("Bluetooth Earbuds Pro ₹269", { kind: "card", href: null }))).toEqual({ text: "Bluetooth Earbuds Pro" });
  });
});

describe("findAdvertisedDeal", () => {
  it("finds the headline deal but not a plain product card", () => {
    const f = page("/", { candidates: [c("Laptop Stand ₹899", { hasPrice: true }), c("Mega deal: Earbuds at just ₹499!", { hasPrice: true })] });
    expect(findAdvertisedDeal(f)?.text).toContain("Mega deal");
    expect(findAdvertisedDeal(page("/", { candidates: [c("Laptop Stand ₹899", { hasPrice: true })] }))).toBeNull();
  });
});

describe("shortlist", () => {
  it("puts page content before site chrome and drops unsafe or disabled controls", () => {
    const f = page("/", { candidates: [c("Menu", { inNav: true }), btn("Pay now"), btn("Wishlist", { disabled: true }), c("Cable ₹299")] });
    expect(shortlist(f).map((x) => x.text)).toEqual(["Cable ₹299", "Menu"]);
  });
});
